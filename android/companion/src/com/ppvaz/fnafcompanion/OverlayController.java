package com.ppvaz.fnafcompanion;

import android.content.Context;
import android.graphics.PixelFormat;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * Owns the Companion's overlay windows: the per-game teach panels.
 *
 * <p>Every panel is its own non-focusable, non-touchable window of exactly its
 * lesson's native rectangle. Its clearance from what the helper reads is a
 * matter of geometry, not opacity: Android composites an untrusted overlay at
 * no more than the maximum obscuring opacity (0.8 measured on the moto g56,
 * 2026-09-18), so a fifth of the game always shows through and an "opaque"
 * window cannot be proved opaque. The full-screen sensor/debug HUD and its
 * self-capture qualification gate, which never qualified, left on 2026-09-27
 * with the watchlist ROIs it drew.</p>
 */
public final class OverlayController {
    private static final String TAG = "FnafCueHelper";
    private static final long IDENTITY_LOSS_GRACE_NS = 250_000_000L;

    public interface Listener {
        void onOverlayStateChanged(String state);
    }

    private final Context context;
    private final WindowManager windowManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Listener listener;

    private volatile boolean captureActive;
    private volatile int targetVisibility = -1;
    private volatile int captureWidth = NativeFrame.WIDTH;
    private volatile int captureHeight = NativeFrame.HEIGHT;
    // The FNaF 2 teach panel: its own window, exactly TeachPanel's rectangle,
    // shown only over a positively identified night while a lesson runs.
    private volatile CycleLesson teachLesson;
    private volatile long teachOnsetNs;
    private volatile long teachOriginNs;
    private volatile boolean teachRunning;
    private volatile TeachPanelView teachView;
    private volatile boolean teachAttached;
    private volatile long teachDetachedAtNs;
    private volatile String teachState = "OFF";
    private final Runnable teachIdentityLoss = this::finishTeachIdentityLoss;
    private volatile long teachLastNightNs;

    public OverlayController(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        windowManager = this.context.getSystemService(WindowManager.class);
    }

    public String status() {
        return "overlay=" + (permissionGranted() ? "READY" : "DISABLED(permission)")
                + " teach=" + teachState
                + " f1=" + (f1View != null ? "ATTACHED" : "NONE")
                + " f3=" + (f3View != null ? "ATTACHED" : "NONE")
                + " f4=" + (f4View != null ? "ATTACHED" : "NONE");
    }

    /**
     * True when a frame captured at {@code frameNs} (image time, the
     * System.nanoTime() clock) may contain the FNaF 2 teach panel: whenever it
     * is attached, and for frames captured within a compositor margin after it
     * detached. The FNaF 2 legacy readers then withhold the one reader that
     * cannot avoid the panel's rectangle.
     */
    public boolean teachMayBeVisible(long frameNs) {
        if (teachAttached) return true;
        long detached = teachDetachedAtNs;
        if (detached == 0L) return false;
        long at = frameNs > 0L ? frameNs : System.nanoTime();
        return at < detached + TeachPanel.WITHHOLD_AFTER_DETACH_NS;
    }

    /**
     * Hold a committed lesson until the schedule's origin arrives. Debug builds
     * only: the panel is a demonstration aid whose clearance is proved by host
     * tests, not a qualified run HUD.
     */
    public String armTeach(CycleLesson lesson) {
        if (lesson == null) return "ERROR lesson-null";
        if (!debuggable()) return "ERROR teach-release-build";
        if (!permissionGranted()) return "ERROR teach-permission";
        // Synchronous, so an origin that follows the commit finds the lesson.
        stopTeachNow("ARMED:" + lesson.id);
        teachLesson = lesson;
        mainHandler.post(this::emit);
        return "OK teach=ARMED " + lesson.status();
    }

    /** Start narrating from the helper's own latched onset plus the release interval. */
    public String startTeach(long onsetNs, long afterOnsetUs) {
        CycleLesson lesson = teachLesson;
        if (lesson == null) return "ERROR lesson-not-armed";
        if (!captureActive) return "ERROR teach-capture-inactive";
        long originNs = onsetNs + afterOnsetUs * 1_000L;
        teachOnsetNs = onsetNs;
        teachOriginNs = originNs;
        teachState = "RUNNING:" + lesson.id;
        // Written last: the capture thread reads the origin once this is true.
        teachRunning = true;
        mainHandler.post(this::emit);
        return "OK teach=RUNNING lesson=" + lesson.id + " originNs=" + originNs;
    }

    public String clearTeach() {
        stopTeachNow("OFF");
        mainHandler.post(this::emit);
        return "OK teach=OFF";
    }

    // The FNaF 1 teach panel: its own lesson and window, shown from the
    // origin the host names until the host clears it. Debug builds only.
    private volatile Fnaf1Lesson f1Lesson = new Fnaf1Lesson();
    private volatile Fnaf1PanelView f1View;

    /** {@code LESSON <token> f1 <origin|step|seen|door|clear|status> ...}. */
    public String f1Command(String[] field, int from) {
        if (!debuggable()) return "ERROR teach-release-build";
        if (field.length <= from) return "ERROR f1-usage";
        String verb = field[from];
        if ("clear".equals(verb)) {
            mainHandler.post(this::detachF1);
            f1Lesson = new Fnaf1Lesson();
            return "OK f1=OFF";
        }
        if ("status".equals(verb)) {
            return "OK f1=" + (f1View != null ? "ATTACHED" : "NONE")
                    + " originNs=" + f1Lesson.originNs() + " step=" + f1Lesson.step();
        }
        if (!permissionGranted()) return "ERROR teach-permission";
        f1Lesson.apply(field, from);
        if ("origin".equals(verb)) mainHandler.post(this::attachF1);
        return "OK f1=" + verb;
    }

    private void attachF1() {
        if (f1View != null || windowManager == null) return;
        Fnaf1PanelView panel = new Fnaf1PanelView(context, f1Lesson);
        if (addPanel(panel, Fnaf1Lesson.LEFT, Fnaf1Lesson.TOP, Fnaf1Lesson.RIGHT, Fnaf1Lesson.BOTTOM,
                "FNaF 1 teach panel")) {
            f1View = panel;
            emit();
        }
    }

    private void detachF1() {
        Fnaf1PanelView current = f1View;
        f1View = null;
        removePanel(current);
        emit();
    }

    // The FNaF 4 teach panel: its own lesson and window, the same contract as
    // FNaF 1's (origin attaches, clear detaches). Debug builds only.
    private volatile Fnaf4Lesson f4Lesson = new Fnaf4Lesson();
    private volatile Fnaf4PanelView f4View;

    /** {@code LESSON <token> f4 <origin|step|door|closet|bed|level|clear|status> ...}. */
    public String f4Command(String[] field, int from) {
        if (!debuggable()) return "ERROR teach-release-build";
        if (field.length <= from) return "ERROR f4-usage";
        String verb = field[from];
        if ("clear".equals(verb)) {
            mainHandler.post(this::detachF4);
            f4Lesson = new Fnaf4Lesson();
            return "OK f4=OFF";
        }
        if ("status".equals(verb)) {
            return "OK f4=" + (f4View != null ? "ATTACHED" : "NONE")
                    + " originNs=" + f4Lesson.originNs() + " step=" + f4Lesson.step();
        }
        if (!permissionGranted()) return "ERROR teach-permission";
        f4Lesson.apply(field, from, System.nanoTime());
        if ("origin".equals(verb)) mainHandler.post(this::attachF4);
        return "OK f4=" + verb;
    }

    private void attachF4() {
        if (f4View != null || windowManager == null) return;
        Fnaf4PanelView panel = new Fnaf4PanelView(context, f4Lesson);
        if (addPanel(panel, Fnaf4Lesson.LEFT, Fnaf4Lesson.TOP, Fnaf4Lesson.RIGHT, Fnaf4Lesson.BOTTOM,
                "FNaF 4 teach panel")) {
            f4View = panel;
            emit();
        }
    }

    private void detachF4() {
        Fnaf4PanelView current = f4View;
        f4View = null;
        removePanel(current);
        emit();
    }

    // The FNaF 3 teach panel: its own lesson and window, the same contract as
    // FNaF 1's and FNaF 4's (origin attaches, clear detaches). Debug builds only.
    private volatile Fnaf3Lesson f3Lesson = new Fnaf3Lesson();
    private volatile Fnaf3PanelView f3View;

    /** {@code LESSON <token> f3 <origin|night|step|look|seen|sealed|lure|sys|clear|status> ...}. */
    public String f3Command(String[] field, int from) {
        if (!debuggable()) return "ERROR teach-release-build";
        if (field.length <= from) return "ERROR f3-usage";
        String verb = field[from];
        if ("clear".equals(verb)) {
            mainHandler.post(this::detachF3);
            f3Lesson = new Fnaf3Lesson();
            return "OK f3=OFF";
        }
        if ("status".equals(verb)) {
            return "OK f3=" + (f3View != null ? "ATTACHED" : "NONE")
                    + " originNs=" + f3Lesson.originNs() + " step=" + f3Lesson.step();
        }
        if (!permissionGranted()) return "ERROR teach-permission";
        f3Lesson.apply(field, from, System.nanoTime());
        if ("origin".equals(verb)) mainHandler.post(this::attachF3);
        return "OK f3=" + verb;
    }

    private void attachF3() {
        if (f3View != null || windowManager == null) return;
        Fnaf3PanelView panel = new Fnaf3PanelView(context, f3Lesson);
        if (addPanel(panel, Fnaf3Lesson.LEFT, Fnaf3Lesson.TOP, Fnaf3Lesson.RIGHT, Fnaf3Lesson.BOTTOM,
                "FNaF 3 teach panel")) {
            f3View = panel;
            emit();
        }
    }

    private void detachF3() {
        Fnaf3PanelView current = f3View;
        f3View = null;
        removePanel(current);
        emit();
    }

    /**
     * Attach a teach panel window at a native content rectangle, refusing a
     * display that is not the native 2400x1080 content space: its clearance
     * from the native regions is proved in native pixels, so any scale or
     * shift would void it.
     */
    private boolean addPanel(View panel, int nativeLeft, int nativeTop, int nativeRight,
            int nativeBottom, String name) {
        if (!nativeDisplay()) {
            Log.w(TAG, name + " refused: display is not the native content space");
            return false;
        }
        WindowManager.LayoutParams params = panelParams(nativeLeft, nativeTop,
                nativeRight - nativeLeft, nativeBottom - nativeTop, name);
        try {
            windowManager.addView(panel, params);
            return true;
        } catch (RuntimeException error) {
            Log.e(TAG, name + " attach failed", error);
            return false;
        }
    }

    private WindowManager.LayoutParams panelParams(int left, int top, int width, int height,
            String name) {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                width, height,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.OPAQUE);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = left;
        params.y = top;
        // The game renders edge-to-edge through the cutout into the same
        // 2400x1080 surface MediaProjection captures; system insets are not a
        // translation of game pixels, so the window opts out of them.
        if (Build.VERSION.SDK_INT >= 30) params.setFitInsetsTypes(0);
        if (Build.VERSION.SDK_INT >= 28) {
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }
        // The platform composites an untrusted, non-touchable overlay at no more
        // than the maximum obscuring opacity whatever is asked (measured
        // 2026-09-18: 1.0 asked, dumpsys alpha=0.8). Ask for that cap rather
        // than pretend; clearance is geometric, never a matter of opacity.
        params.alpha = maximumObscuringOpacity();
        params.packageName = context.getPackageName();
        params.setTitle("FNaF Companion " + name);
        return params;
    }

    /** Idempotent teardown of a panel window. */
    private void removePanel(View panel) {
        if (panel == null || windowManager == null) return;
        try {
            windowManager.removeViewImmediate(panel);
        } catch (RuntimeException ignored) {
            // Idempotent teardown.
        }
    }

    public String teachStatus() {
        CycleLesson lesson = teachLesson;
        return "OK teach=" + teachState + " window=" + (teachAttached ? "ATTACHED" : "NONE")
                + (lesson == null ? "" : " " + lesson.status())
                + (teachRunning ? " originNs=" + teachOriginNs + " onsetNs=" + teachOnsetNs : "");
    }

    /** Capture thread: whether a lesson is running and wants frames. */
    public boolean teachRunning() {
        return teachRunning;
    }

    /**
     * Capture thread: the newest frame's identity and the helper's own reading
     * of the bottom controls, coalesced to one main-thread update.
     */
    public void onTeachFrame(int identity, PixelWatch.ControlState control) {
        teachIdentity = identity;
        teachControl = control == null ? PixelWatch.ControlState.UNKNOWN : control;
        if (teachFrameQueued.compareAndSet(false, true)) mainHandler.post(teachFrameDispatch);
    }

    private volatile int teachIdentity = ScreenIdentity.UNKNOWN;
    private volatile PixelWatch.ControlState teachControl = PixelWatch.ControlState.UNKNOWN;
    private final java.util.concurrent.atomic.AtomicBoolean teachFrameQueued =
            new java.util.concurrent.atomic.AtomicBoolean();
    private final Runnable teachFrameDispatch = this::drainTeachFrame;

    private void drainTeachFrame() {
        teachFrameQueued.set(false);
        updateTeach(teachIdentity, teachControl);
    }

    /** Main thread: show the running lesson over a night, hide it on anything else. */
    private void updateTeach(int identity, PixelWatch.ControlState control) {
        if (!teachRunning) return;
        CycleLesson lesson = teachLesson;
        long now = System.nanoTime();
        if (lesson == null || !captureActive
                || now - teachOriginNs >= (long) lesson.observeUntilMs * 1_000_000L) {
            stopTeachNow(lesson == null ? "OFF" : "EXPIRED:" + lesson.id);
            emit();
            return;
        }
        TeachPanelView current = teachView;
        if (current != null) current.setSeen(control);
        // A night by its grid, or a dark frame whose bottom controls the helper
        // still reads, keeps the panel. Any other positive screen hides it at
        // once; an unreadable frame gets a short grace, counted from the last
        // night frame so a run of them cannot hold it up.
        boolean night = identity == ScreenIdentity.FNAF2_NIGHT
                || identity == ScreenIdentity.UNKNOWN
                        && control != PixelWatch.ControlState.UNKNOWN;
        if (night) {
            teachLastNightNs = now;
            mainHandler.removeCallbacks(teachIdentityLoss);
            attachTeach(lesson);
        } else if (identity == ScreenIdentity.UNKNOWN) {
            if (teachAttached && !mainHandler.hasCallbacks(teachIdentityLoss)) {
                mainHandler.postDelayed(teachIdentityLoss, IDENTITY_LOSS_GRACE_NS / 1_000_000L);
            }
        } else {
            detachTeach();
        }
    }

    private void finishTeachIdentityLoss() {
        if (!teachAttached) return;
        long quiet = System.nanoTime() - teachLastNightNs;
        if (quiet < IDENTITY_LOSS_GRACE_NS) {
            mainHandler.postDelayed(teachIdentityLoss,
                    Math.max(1L, (IDENTITY_LOSS_GRACE_NS - quiet) / 1_000_000L));
            return;
        }
        detachTeach();
    }

    private void attachTeach(CycleLesson lesson) {
        if (teachAttached) return;
        if (!permissionGranted()) {
            setTeachState("BLOCKED(permission):" + lesson.id);
            return;
        }
        if (targetVisibility == 0 || windowManager == null) return;
        // The clearance proof is in native content pixels: refuse a capture or
        // display that would scale, rotate, or shift the rectangle.
        if (captureWidth != NativeFrame.WIDTH || captureHeight != NativeFrame.HEIGHT
                || !nativeDisplay()) {
            Log.w(TAG, "teach panel refused: capture " + captureWidth + "x" + captureHeight
                    + " or display not native");
            setTeachState("BLOCKED(teach-geometry):" + lesson.id);
            return;
        }
        TeachPanelView panel = new TeachPanelView(context);
        panel.start(lesson, teachOnsetNs, teachOriginNs);
        panel.setSeen(teachControl);
        WindowManager.LayoutParams params = panelParams(TeachPanel.LEFT, TeachPanel.TOP,
                TeachPanel.WIDTH, TeachPanel.HEIGHT, "FNaF 2 teach panel");
        // Readers are withheld from the moment the panel can be composited.
        teachDetachedAtNs = 0L;
        teachAttached = true;
        try {
            windowManager.addView(panel, params);
            teachView = panel;
            setTeachState("RUNNING:" + lesson.id);
        } catch (RuntimeException error) {
            Log.e(TAG, "teach panel attach failed", error);
            teachDetachedAtNs = System.nanoTime();
            teachAttached = false;
            setTeachState("ERROR(" + error.getClass().getSimpleName() + "):" + lesson.id);
        }
    }

    private void detachTeach() {
        if (!isMainThread()) {
            mainHandler.post(this::detachTeach);
            return;
        }
        mainHandler.removeCallbacks(teachIdentityLoss);
        TeachPanelView current = teachView;
        teachView = null;
        if (teachAttached) teachDetachedAtNs = System.nanoTime();
        teachAttached = false;
        removePanel(current);
    }

    /** Publish a teach state change once, not once per captured frame. */
    private void setTeachState(String next) {
        if (next.equals(teachState)) return;
        teachState = next;
        emit();
    }

    private void stopTeachNow(String next) {
        teachRunning = false;
        teachLesson = null;
        teachState = next;
        detachTeach();
    }

    public void onCaptureStarted(int width, int height) {
        captureActive = true;
        captureWidth = width;
        captureHeight = height;
        targetVisibility = -1;
        emit();
    }

    public void onCaptureResized(int width, int height) {
        if (width < 1 || height < 1) return;
        captureWidth = width;
        captureHeight = height;
    }

    public void onTargetVisibilityChanged(int visibility) {
        targetVisibility = visibility;
        if (visibility == 0) mainHandler.post(this::detachTeach);
    }

    public void onCaptureStopped() {
        captureActive = false;
        targetVisibility = -1;
        // A new capture generation re-latches the onset; the origin is void.
        stopTeachNow("OFF");
        emit();
    }

    public void destroy() {
        captureActive = false;
        stopTeachNow("OFF");
        mainHandler.post(() -> {
            detachF1();
            detachF3();
            detachF4();
        });
    }

    private boolean debuggable() {
        return (context.getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Whether the physical display is the native 2400x1080 content space. */
    private boolean nativeDisplay() {
        Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
        if (display == null) return false;
        DisplayMetrics metrics = new DisplayMetrics();
        display.getRealMetrics(metrics);
        return metrics.widthPixels == NativeFrame.WIDTH && metrics.heightPixels == NativeFrame.HEIGHT;
    }

    private boolean isMainThread() {
        return Looper.myLooper() == Looper.getMainLooper();
    }

    private float maximumObscuringOpacity() {
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                InputManager input = context.getSystemService(InputManager.class);
                if (input != null) return input.getMaximumObscuringOpacityForTouch();
            } catch (RuntimeException ignored) {
                // Keep the known platform maximum.
            }
        }
        return .8f;
    }

    public boolean permissionGranted() {
        return Settings.canDrawOverlays(context);
    }

    private void emit() {
        if (listener != null) listener.onOverlayStateChanged(status());
    }
}
