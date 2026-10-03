/*
 * potato-full-speed: a GIO power-profile monitor for Potato Tomato's WebKit web processes.
 *
 * WebKitGTK asks GLib's GPowerProfileMonitor, in the web process, whether the system is in
 * power saver, and if it is, halves rendering updates: requestAnimationFrame runs at 30 fps.
 * That is the right call for a document someone reads and the wrong one for a game, and
 * WebKitGTK 2.52 has no setting to opt out (see docs/field-tests/engine-bench-2026-09-23).
 *
 * This module registers a monitor that wraps the real one rather than replacing it. It
 * creates GLib's own implementation (the D-Bus monitor on a normal desktop, the portal one
 * in a Flatpak) through the same extension point, forwards its answer and its change
 * notifications, and says "not in power saver" only while a game is open. The app marks
 * "a game is open" with a flag file, named in POTATO_TOMATO_GAME_OPEN_FLAG, which this
 * module watches with a GFileMonitor: the app creates it when a game frame starts and
 * removes it when the player leaves, and WebKit follows within a frame or two.
 *
 * It only takes over in a process that is a WebKit web process and was started by the app
 * (the flag variable is set). Anywhere else — a browser opened from the app inherits the
 * environment too — initialisation fails, and GIO moves on to its normal monitor exactly as
 * if this module did not exist. The same happens if the flag cannot be watched.
 *
 * Loaded with GIO_EXTRA_MODULES=<dir containing libpotato-full-speed.so> and selected with
 * GIO_USE_POWER_PROFILE_MONITOR=potato-full-speed (it also has the highest priority), both
 * set by the app in its own environment before the first webview exists; see
 * src-tauri/src/power_profile.rs. For the app's log, it writes one status line per web
 * process it runs in, next to the flag.
 *
 * Kept to the GLib 2.70 API (GPowerProfileMonitor's first release) so a module built on a
 * newer host still loads in an older runtime.
 */
#define GLIB_VERSION_MIN_REQUIRED GLIB_VERSION_2_70
#define GLIB_VERSION_MAX_ALLOWED GLIB_VERSION_2_70
#define G_LOG_DOMAIN "potato-full-speed"

#include <gio/gio.h>
#include <unistd.h>

#define PT_MONITOR_NAME "potato-full-speed"
#define PT_FLAG_ENV "POTATO_TOMATO_GAME_OPEN_FLAG"
#define PT_WEB_PROCESS "WebKitWebProcess"

typedef struct {
  GObject parent;
  /* GLib's own monitor (D-Bus or portal), or NULL when none could start. */
  GPowerProfileMonitor *real;
  GFile *flag;
  GFileMonitor *flag_monitor;
  gboolean game_open;
  /* What this monitor last reported. */
  gboolean saver;
} PtFullSpeed;

typedef struct {
  GObjectClass parent_class;
} PtFullSpeedClass;

enum { PROP_0, PROP_POWER_SAVER_ENABLED };

static GType pt_full_speed_get_type (void);
#define PT_TYPE_FULL_SPEED (pt_full_speed_get_type ())
#define PT_FULL_SPEED(o) (G_TYPE_CHECK_INSTANCE_CAST ((o), PT_TYPE_FULL_SPEED, PtFullSpeed))

static void pt_full_speed_initable_iface_init (GInitableIface *iface);
static void pt_full_speed_monitor_iface_init (GPowerProfileMonitorInterface *iface);

G_DEFINE_TYPE_WITH_CODE (PtFullSpeed, pt_full_speed, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, pt_full_speed_initable_iface_init)
                         G_IMPLEMENT_INTERFACE (G_TYPE_POWER_PROFILE_MONITOR,
                                                pt_full_speed_monitor_iface_init))

static gboolean
real_saver (PtFullSpeed *self)
{
  return self->real != NULL && g_power_profile_monitor_get_power_saver_enabled (self->real);
}

/* Power saver as this monitor reports it: the system's answer, except while a game is open. */
static gboolean
effective_saver (PtFullSpeed *self)
{
  return real_saver (self) && !self->game_open;
}

static void
update (PtFullSpeed *self)
{
  gboolean saver = effective_saver (self);
  if (saver == self->saver)
    return;
  self->saver = saver;
  g_debug ("power-saver-enabled -> %s (system %s, game %s)", saver ? "TRUE" : "FALSE",
           real_saver (self) ? "power-saver" : "normal", self->game_open ? "open" : "closed");
  g_object_notify (G_OBJECT (self), "power-saver-enabled");
}

static void
on_real_changed (GObject *real, GParamSpec *pspec, gpointer user_data)
{
  (void) real;
  (void) pspec;
  update (PT_FULL_SPEED (user_data));
}

static void
on_flag_changed (GFileMonitor *monitor, GFile *file, GFile *other, GFileMonitorEvent event,
                 gpointer user_data)
{
  PtFullSpeed *self = PT_FULL_SPEED (user_data);
  (void) monitor;
  (void) file;
  (void) other;
  (void) event;
  self->game_open = g_file_query_exists (self->flag, NULL);
  update (self);
}

/* Only a WebKit web process started by the app: never a browser that inherited the env. */
static gboolean
is_app_web_process (void)
{
  const char *flag = g_getenv (PT_FLAG_ENV);
  gchar *exe;
  gchar *base;
  gboolean ours;

  if (flag == NULL || *flag == '\0' || !g_path_is_absolute (flag))
    return FALSE;
  exe = g_file_read_link ("/proc/self/exe", NULL);
  if (exe == NULL)
    return FALSE;
  base = g_path_get_basename (exe);
  ours = g_strcmp0 (base, PT_WEB_PROCESS) == 0;
  g_free (base);
  g_free (exe);
  return ours;
}

/*
 * GLib's own implementation, created the way GIO would have: every other extension of the
 * power-profile-monitor point, in priority order (portal first, then D-Bus), first one whose
 * initialisation succeeds. We are called from inside GIO's own lookup, so this must not go
 * through g_power_profile_monitor_dup_default().
 */
static GPowerProfileMonitor *
dup_real_monitor (GCancellable *cancellable, const char **name_out)
{
  GIOExtensionPoint *point =
      g_io_extension_point_lookup (G_POWER_PROFILE_MONITOR_EXTENSION_POINT_NAME);
  GList *l;

  for (l = point ? g_io_extension_point_get_extensions (point) : NULL; l != NULL; l = l->next)
    {
      GIOExtension *extension = l->data;
      GType type = g_io_extension_get_type (extension);
      GError *error = NULL;
      GObject *monitor;

      if (type == PT_TYPE_FULL_SPEED || !g_type_is_a (type, G_TYPE_POWER_PROFILE_MONITOR))
        continue;
      if (g_type_is_a (type, G_TYPE_INITABLE))
        monitor = g_initable_new (type, cancellable, &error, NULL);
      else
        monitor = g_object_new (type, NULL);
      if (monitor != NULL)
        {
          *name_out = g_io_extension_get_name (extension);
          return G_POWER_PROFILE_MONITOR (monitor);
        }
      g_debug ("%s unavailable: %s", g_io_extension_get_name (extension),
               error ? error->message : "unknown error");
      g_clear_error (&error);
    }
  return NULL;
}

/* One line per web process for the app's log: `<flag dir>/web-<pid>`. */
static void
write_status (PtFullSpeed *self, const char *real_name)
{
  GFile *dir = g_file_get_parent (self->flag);
  gchar *dir_path;
  gchar *name;
  gchar *path;
  gchar *line;

  if (dir == NULL)
    return;
  dir_path = g_file_get_path (dir);
  name = g_strdup_printf ("web-%d", (int) getpid ());
  path = g_build_filename (dir_path, name, NULL);
  line = g_strdup_printf ("pid=%d wraps=%s\n", (int) getpid (), real_name ? real_name : "none");
  g_file_set_contents (path, line, -1, NULL);
  g_free (line);
  g_free (path);
  g_free (name);
  g_free (dir_path);
  g_object_unref (dir);
}

static gboolean
pt_full_speed_initable_init (GInitable *initable, GCancellable *cancellable, GError **error)
{
  PtFullSpeed *self = PT_FULL_SPEED (initable);
  const char *real_name = NULL;
  GError *watch_error = NULL;

  if (!is_app_web_process ())
    {
      g_set_error_literal (error, G_IO_ERROR, G_IO_ERROR_NOT_SUPPORTED,
                           "not a Potato Tomato web process");
      return FALSE;
    }

  self->flag = g_file_new_for_path (g_getenv (PT_FLAG_ENV));
  self->flag_monitor = g_file_monitor_file (self->flag, G_FILE_MONITOR_NONE, cancellable,
                                            &watch_error);
  if (self->flag_monitor == NULL)
    {
      /* Without a watch we could not follow the game closing: stay out of the way. */
      g_propagate_error (error, watch_error);
      return FALSE;
    }
  g_signal_connect (self->flag_monitor, "changed", G_CALLBACK (on_flag_changed), self);

  self->real = dup_real_monitor (cancellable, &real_name);
  if (self->real != NULL)
    g_signal_connect (self->real, "notify::power-saver-enabled", G_CALLBACK (on_real_changed),
                      self);

  self->game_open = g_file_query_exists (self->flag, NULL);
  self->saver = effective_saver (self);
  write_status (self, real_name);
  g_debug ("active in web process %d, wrapping %s; game %s", (int) getpid (),
           real_name ? real_name : "nothing", self->game_open ? "open" : "closed");
  return TRUE;
}

static void
pt_full_speed_get_property (GObject *object, guint id, GValue *value, GParamSpec *pspec)
{
  PtFullSpeed *self = PT_FULL_SPEED (object);
  if (id == PROP_POWER_SAVER_ENABLED)
    g_value_set_boolean (value, effective_saver (self));
  else
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, id, pspec);
}

static void
pt_full_speed_dispose (GObject *object)
{
  PtFullSpeed *self = PT_FULL_SPEED (object);
  if (self->flag_monitor != NULL)
    {
      g_signal_handlers_disconnect_by_data (self->flag_monitor, self);
      g_file_monitor_cancel (self->flag_monitor);
      g_clear_object (&self->flag_monitor);
    }
  if (self->real != NULL)
    {
      g_signal_handlers_disconnect_by_data (self->real, self);
      g_clear_object (&self->real);
    }
  g_clear_object (&self->flag);
  G_OBJECT_CLASS (pt_full_speed_parent_class)->dispose (object);
}

static void
pt_full_speed_init (PtFullSpeed *self)
{
  (void) self;
}

static void
pt_full_speed_class_init (PtFullSpeedClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->get_property = pt_full_speed_get_property;
  object_class->dispose = pt_full_speed_dispose;
  g_object_class_override_property (object_class, PROP_POWER_SAVER_ENABLED,
                                    "power-saver-enabled");
}

static void
pt_full_speed_initable_iface_init (GInitableIface *iface)
{
  iface->init = pt_full_speed_initable_init;
}

static void
pt_full_speed_monitor_iface_init (GPowerProfileMonitorInterface *iface)
{
  (void) iface;
}

G_MODULE_EXPORT void
g_io_module_load (GIOModule *module)
{
  /* Stay resident: the type above is static and GIO must never unload it. */
  g_type_module_use (G_TYPE_MODULE (module));
  g_io_extension_point_implement (G_POWER_PROFILE_MONITOR_EXTENSION_POINT_NAME,
                                  PT_TYPE_FULL_SPEED, PT_MONITOR_NAME, 1000);
}

G_MODULE_EXPORT void
g_io_module_unload (GIOModule *module)
{
  (void) module;
}

G_MODULE_EXPORT char **
g_io_module_query (void)
{
  char *points[] = { G_POWER_PROFILE_MONITOR_EXTENSION_POINT_NAME, NULL };
  return g_strdupv (points);
}
