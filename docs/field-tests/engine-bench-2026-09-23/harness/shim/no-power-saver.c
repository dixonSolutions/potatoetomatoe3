/* Bench-only shim: make GIO report "power saver off" so WebKitGTK's LowPowerMode
 * (which halves requestAnimationFrame to 30 fps) can be measured on and off without
 * touching the machine's actual power profile. */
typedef int gboolean;
typedef struct _GPowerProfileMonitor GPowerProfileMonitor;
gboolean g_power_profile_monitor_get_power_saver_enabled(GPowerProfileMonitor *monitor) {
  (void)monitor;
  return 0;
}
