import android.os.IBinder;
import java.io.File;
import java.lang.reflect.Method;

/**
 * Holds the phone's wall clock at one value through a window, from ONE process.
 *
 *   CLASSPATH=/data/local/tmp/pinner.dex app_process / Pinner VALUE START_AT_WALL_MS MAX_MS STOP_FILE [THREADS]
 *
 * `cmd alarm set-time` spawns a process per set (about 34 ms), which caps a pin at roughly one
 * chance in five of reading its exact millisecond. This calls the alarm service's setTime directly
 * in a tight loop, so the clock is re-set far more often than once per millisecond while it runs.
 *
 * Safety: pinning stops at MAX_MS whatever happens, or as soon as STOP_FILE exists, and the finally
 * block always puts real time back: the wall and monotonic clocks are read back to back before the
 * pin, so real time after it is their sum, with no uptime rounding and no process-spawn latency.
 */
public class Pinner {
  public static void main(String[] args) throws Exception {
    final long value = Long.parseLong(args[0]);
    final long startAt = Long.parseLong(args[1]);
    final long maxMs = Math.min(Long.parseLong(args[2]), 3000);        // hard cap: 3 s
    final File stop = new File(args[3]);
    final int threads = args.length > 4 ? Math.max(1, Math.min(Integer.parseInt(args[4]), 8)) : 1;

    Class<?> sm = Class.forName("android.os.ServiceManager");
    IBinder binder = (IBinder) sm.getMethod("getService", String.class).invoke(null, "alarm");
    Class<?> stub = Class.forName("android.app.IAlarmManager$Stub");
    final Object alarm = stub.getMethod("asInterface", IBinder.class).invoke(null, binder);
    final Method setTime = alarm.getClass().getMethod("setTime", long.class);

    final long wall0 = System.currentTimeMillis();
    final long mono0 = System.nanoTime();
    // Restore exactly once, from the finally block or -- if the process is signalled -- a shutdown hook.
    final java.util.concurrent.atomic.AtomicBoolean restored = new java.util.concurrent.atomic.AtomicBoolean(false);
    final Runnable restore = () -> {
      if (!restored.compareAndSet(false, true)) return;
      try { setTime.invoke(alarm, wall0 + (System.nanoTime() - mono0) / 1_000_000L); }
      catch (Exception e) { System.err.println("restore failed: " + e); }
    };
    Runtime.getRuntime().addShutdownHook(new Thread(restore));
    while (System.currentTimeMillis() < startAt && !stop.exists()) Thread.sleep(1);
    final long pinMono = System.nanoTime();
    final long pinWall0 = wall0 + (pinMono - mono0) / 1_000_000L;
    final long[] sets = new long[threads];
    final long deadline = pinMono + maxMs * 1_000_000L;
    Thread[] pool = new Thread[threads];
    try {
      for (int t = 0; t < threads; t++) {
        final int id = t;
        pool[t] = new Thread(() -> {
          try {
            while (System.nanoTime() < deadline && !stop.exists()) { setTime.invoke(alarm, value); sets[id]++; }
          } catch (Exception e) { System.err.println("pin thread " + id + ": " + e); }
        });
        pool[t].start();
      }
      for (Thread t : pool) t.join();
    } finally {
      long real = wall0 + (System.nanoTime() - mono0) / 1_000_000L;
      restore.run();
      long total = 0; for (long s : sets) total += s;
      long heldMs = (System.nanoTime() - pinMono) / 1_000_000L;
      System.out.println("pinned value=" + value + " low16=" + (value % 65536) + " wall_at_pin=" + pinWall0
          + " held_ms=" + heldMs + " sets=" + total + " threads=" + threads
          + " restored=" + real + " wall_after=" + System.currentTimeMillis());
    }
  }
}
