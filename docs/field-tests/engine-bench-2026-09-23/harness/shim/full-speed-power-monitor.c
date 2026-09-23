/*
 * Prototype for option (b1): a GIO module that implements GPowerProfileMonitor and always
 * reports "power saver off". Loaded with
 *   GIO_EXTRA_MODULES=<dir containing this .so>
 *   GIO_USE_POWER_PROFILE_MONITOR=full-speed
 * in the app's environment, which WebKit's web process inherits. If the module is missing
 * or fails to load, GIO falls back to its normal D-Bus/portal monitor on its own.
 */
#include <gio/gio.h>

#define TYPE_FULL_SPEED (full_speed_get_type())
typedef struct { GObject parent; } FullSpeed;
typedef struct { GObjectClass parent_class; } FullSpeedClass;

enum { PROP_0, PROP_POWER_SAVER_ENABLED };

static void full_speed_iface_init(GPowerProfileMonitorInterface *iface) { (void)iface; }
static gboolean full_speed_initable_init(GInitable *i, GCancellable *c, GError **e) {
  (void)i; (void)c; (void)e;
  return TRUE;
}
static void full_speed_initable_iface_init(GInitableIface *iface) { iface->init = full_speed_initable_init; }

G_DEFINE_TYPE_WITH_CODE(FullSpeed, full_speed, G_TYPE_OBJECT,
  G_IMPLEMENT_INTERFACE(G_TYPE_INITABLE, full_speed_initable_iface_init)
  G_IMPLEMENT_INTERFACE(G_TYPE_POWER_PROFILE_MONITOR, full_speed_iface_init))

static void full_speed_get_property(GObject *o, guint id, GValue *v, GParamSpec *p) {
  (void)o;
  if (id == PROP_POWER_SAVER_ENABLED) g_value_set_boolean(v, FALSE);
  else G_OBJECT_WARN_INVALID_PROPERTY_ID(o, id, p);
}
static void full_speed_init(FullSpeed *self) { (void)self; }
static void full_speed_class_init(FullSpeedClass *klass) {
  GObjectClass *oc = G_OBJECT_CLASS(klass);
  oc->get_property = full_speed_get_property;
  g_object_class_override_property(oc, PROP_POWER_SAVER_ENABLED, "power-saver-enabled");
}

G_MODULE_EXPORT void g_io_module_load(GIOModule *module) {
  g_type_module_use(G_TYPE_MODULE(module));
  g_io_extension_point_implement(G_POWER_PROFILE_MONITOR_EXTENSION_POINT_NAME,
                                 TYPE_FULL_SPEED, "full-speed", 1000);
}
G_MODULE_EXPORT void g_io_module_unload(GIOModule *module) { (void)module; }
G_MODULE_EXPORT char **g_io_module_query(void) {
  char *eps[] = { G_POWER_PROFILE_MONITOR_EXTENSION_POINT_NAME, NULL };
  return g_strdupv(eps);
}
