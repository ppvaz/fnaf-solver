package com.ppvaz.fnafcompanion;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.input.InputManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Owns the single permission-gated, non-interactive overlay window. */
public final class OverlayController {
    public static final String PREFS = "overlay";
    public static final String PREF_ENABLED = "enabled";
    public static final String PREF_MODE = "mode";
    private static final long IDENTITY_LOSS_GRACE_NS = 250_000_000L;

    public interface Listener {
        void onOverlayStateChanged(String state);
    }

    private final Context context;
    private final WindowManager windowManager;
    private final DisplayManager displayManager;
    private final SharedPreferences preferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final OverlayGeometry.Contract contract = OverlayGeometry.defaultContract();
    private final Listener listener;
    private final OverlayMetrics metrics = new OverlayMetrics();
    private static final int NO_PENDING_IDENTITY = Integer.MIN_VALUE;
    private final Object mainQueueLock = new Object();
    private int pendingCapturedIdentity = NO_PENDING_IDENTITY;
    private boolean capturedIdentityDispatchQueued;
    private OverlayView pendingSnapshotView;
    private OverlaySnapshot pendingSnapshot;
    private boolean snapshotDispatchQueued;
    private final Runnable capturedIdentityDispatch = this::drainCapturedIdentity;
    private final Runnable snapshotDispatch = this::drainSnapshot;
    private final DisplayManager.DisplayListener displayListener =
            new DisplayManager.DisplayListener() {
                @Override
                public void onDisplayAdded(int displayId) {
                }

                @Override
                public void onDisplayRemoved(int displayId) {
                    if (displayId == defaultDisplayId()) {
                        detach(null);
                        emit("UNAVAILABLE(display-removed)");
                    }
                }

                @Override
                public void onDisplayChanged(int displayId) {
                    if (displayId == defaultDisplayId()) {
                        boolean restore = captureActive && (enabled() || qualificationProbe)
                                && (captureGate.qualified || qualificationProbe)
                                && permissionGranted()
                                && targetVisibility != 0 && capturedRecognizedIdentity;
                        detach(null);
                        emit("UNAVAILABLE(display-changed)");
                        if (restore) {
                            // Rotation/insets are not stable during the display
                            // callback. Rebuild the transform after the platform
                            // has published the new display metrics.
                            mainHandler.post(() -> {
                                if (captureActive && (enabled() || qualificationProbe)
                                        && (captureGate.qualified || qualificationProbe)
                                        && permissionGranted()
                                        && targetVisibility != 0 && capturedRecognizedIdentity) {
                                    attachIfAllowed();
                                }
                            });
                        }
                    }
                }
            };

    private volatile OverlayView view;
    private volatile boolean windowAttached;
    private WindowManager.LayoutParams layoutParams;
    private volatile OverlaySnapshot.Mode mode;
    private volatile boolean qualificationProbe;
    private volatile OverlaySnapshot latestDecisionSnapshot;
    private volatile OverlayCaptureGate captureGate = OverlayCaptureGate.unqualified(
            contract.profileId);
    private volatile boolean captureActive;
    private volatile int targetVisibility = -1;
    /** Last positively identified game/lifecycle frame; UNKNOWN gets a short grace. */
    private volatile boolean capturedRecognizedIdentity;
    private volatile long lastRecognizedIdentityNs;
    private final Runnable identityLossRunnable = this::finishIdentityLoss;
    private int captureWidth = PixelWatch.NATIVE_WIDTH;
    private int captureHeight = PixelWatch.NATIVE_HEIGHT;
    private int insetLeft;
    private int insetTop;
    private int insetRight;
    private int insetBottom;
    private boolean displayListenerRegistered;
    private volatile String state;
    // The teach panel: its own window, exactly TeachPanel's rectangle, shown
    // only over a positively identified night while a lesson runs.
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
        displayManager = this.context.getSystemService(DisplayManager.class);
        preferences = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        mode = "run".equals(preferences.getString(PREF_MODE, "debug"))
                ? OverlaySnapshot.Mode.DECISION_RUN
                : OverlaySnapshot.Mode.SENSOR_DEBUG;
        captureGate = loadQualificationRecord();
        state = permissionGranted() ? "READY" : "DISABLED(permission)";
    }

    public OverlayGeometry.Contract contract() {
        return contract;
    }

    public OverlaySnapshot.Mode mode() {
        return mode;
    }

    public String status() {
        return "overlay=" + state + " gate=" + captureGate.status()
                + " " + metrics.status() + " teach=" + teachState;
    }

    public boolean enabled() {
        return preferences.getBoolean(PREF_ENABLED, false);
    }

    /** Whether the capture thread needs to feed identity into this controller. */
    public boolean needsCapturedIdentity() {
        return enabled() || qualificationProbe;
    }

    /**
     * True when a frame captured at {@code frameNs} (image time, the
     * System.nanoTime() clock) may contain the teach panel: whenever it is
     * attached, and for frames captured within a compositor margin after it
     * detached. The capture service then withholds the two readers that
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
     * only, like the qualification probe: the panel is a demonstration aid
     * whose clearance is proved by host tests, not a qualified run HUD.
     */
    public String armTeach(CycleLesson lesson) {
        if (lesson == null) return "ERROR lesson-null";
        if ((context.getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            return "ERROR teach-release-build";
        }
        if (!permissionGranted()) return "ERROR teach-permission";
        // Synchronous, so an origin that follows the commit finds the lesson.
        stopTeachNow("ARMED:" + lesson.id);
        teachLesson = lesson;
        mainHandler.post(() -> emit(state));
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
        mainHandler.post(() -> emit(state));
        return "OK teach=RUNNING lesson=" + lesson.id + " originNs=" + originNs;
    }

    public String clearTeach() {
        stopTeachNow("OFF");
        mainHandler.post(() -> emit(state));
        return "OK teach=OFF";
    }

    // The FNaF 1 teach panel: its own lesson and window, shown from the
    // origin the host names until the host clears it. Debug builds only.
    private volatile Fnaf1Lesson f1Lesson = new Fnaf1Lesson();
    private volatile Fnaf1PanelView f1View;

    /** {@code LESSON <token> f1 <origin|step|seen|door|clear|status> ...}. */
    public String f1Command(String[] field, int from) {
        if ((context.getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            return "ERROR teach-release-build";
        }
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
        }
    }

    private void detachF1() {
        Fnaf1PanelView current = f1View;
        f1View = null;
        removePanel(current);
    }

    // The FNaF 4 teach panel: its own lesson and window, the same contract as
    // FNaF 1's (origin attaches, clear detaches). Debug builds only.
    private volatile Fnaf4Lesson f4Lesson = new Fnaf4Lesson();
    private volatile Fnaf4PanelView f4View;

    /** {@code LESSON <token> f4 <origin|step|door|closet|bed|level|clear|status> ...}. */
    public String f4Command(String[] field, int from) {
        if ((context.getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            return "ERROR teach-release-build";
        }
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
        }
    }

    private void detachF4() {
        Fnaf4PanelView current = f4View;
        f4View = null;
        removePanel(current);
    }

    /**
     * Attach a teach panel window at a native content rectangle, refusing any
     * display transform that would scale, rotate or shift it: its clearance
     * from the native regions is proved in native pixels.
     */
    private boolean addPanel(View panel, int nativeLeft, int nativeTop, int nativeRight, int nativeBottom, String name) {
        OverlayGeometry.Transform transform = currentTransform();
        OverlayGeometry.PixelRect rect = transform.display.resolve(new NormalizedRect(
                nativeLeft / (float) PixelWatch.NATIVE_WIDTH,
                nativeTop / (float) PixelWatch.NATIVE_HEIGHT,
                nativeRight / (float) PixelWatch.NATIVE_WIDTH,
                nativeBottom / (float) PixelWatch.NATIVE_HEIGHT));
        int left = Math.round(rect.left);
        int top = Math.round(rect.top);
        int width = Math.round(rect.width());
        int height = Math.round(rect.height());
        if (transform.display.rotation != OverlayGeometry.Rotation.ROTATION_0
                || left != nativeLeft || top != nativeTop
                || width != nativeRight - nativeLeft || height != nativeBottom - nativeTop) {
            Log.w("FnafCueHelper", name + " refused: display rect " + rect);
            return false;
        }
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
        if (Build.VERSION.SDK_INT >= 30) params.setFitInsetsTypes(0);
        if (Build.VERSION.SDK_INT >= 28) {
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }
        params.alpha = maximumObscuringOpacity();
        params.packageName = context.getPackageName();
        params.setTitle("FNaF Companion " + name);
        try {
            windowManager.addView(panel, params);
            return true;
        } catch (RuntimeException error) {
            Log.e("FnafCueHelper", name + " attach failed", error);
            return false;
        }
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
            emit(state);
            return;
        }
        TeachPanelView current = teachView;
        if (current != null) current.setSeen(control);
        // A night by its grid, or a dark frame whose bottom controls the helper
        // still reads, keeps the panel. Any other positive screen hides it at
        // once; an unreadable frame gets the HUD's short grace, counted from
        // the last night frame so a run of them cannot hold it up.
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
        if (windowAttached) {
            // The debug/probe HUD holds the one overlay window.
            setTeachState("BLOCKED(overlay-busy):" + lesson.id);
            return;
        }
        if (!permissionGranted()) {
            setTeachState("BLOCKED(permission):" + lesson.id);
            return;
        }
        if (targetVisibility == 0 || windowManager == null) return;
        // The clearance proof is in native content pixels: refuse a capture or
        // display that would scale, rotate, or shift the rectangle.
        OverlayGeometry.Transform transform = currentTransform();
        OverlayGeometry.PixelRect rect = transform.display.resolve(new NormalizedRect(
                TeachPanel.LEFT / (float) PixelWatch.NATIVE_WIDTH,
                TeachPanel.TOP / (float) PixelWatch.NATIVE_HEIGHT,
                TeachPanel.RIGHT / (float) PixelWatch.NATIVE_WIDTH,
                TeachPanel.BOTTOM / (float) PixelWatch.NATIVE_HEIGHT));
        int left = Math.round(rect.left);
        int top = Math.round(rect.top);
        int width = Math.round(rect.width());
        int height = Math.round(rect.height());
        if (captureWidth != PixelWatch.NATIVE_WIDTH || captureHeight != PixelWatch.NATIVE_HEIGHT
                || transform.display.rotation != OverlayGeometry.Rotation.ROTATION_0
                || left != TeachPanel.LEFT || top != TeachPanel.TOP
                || width != TeachPanel.WIDTH || height != TeachPanel.HEIGHT) {
            Log.w("FnafCueHelper", "teach panel refused: display rect " + rect
                    + " capture " + captureWidth + "x" + captureHeight);
            setTeachState("BLOCKED(teach-geometry):" + lesson.id);
            return;
        }
        TeachPanelView panel = new TeachPanelView(context);
        panel.start(lesson, teachOnsetNs, teachOriginNs);
        panel.setSeen(teachControl);
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
        if (Build.VERSION.SDK_INT >= 30) params.setFitInsetsTypes(0);
        if (Build.VERSION.SDK_INT >= 28) {
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }
        // The platform composites an untrusted, non-touchable overlay at no more
        // than the maximum obscuring opacity whatever is asked (measured
        // 2026-09-18: 1.0 asked, dumpsys alpha=0.8), so a fifth of the game
        // shows through. Ask for that cap rather than pretend. The panel covers
        // no profile control point, so the cap is not what keeps taps working.
        params.alpha = maximumObscuringOpacity();
        params.packageName = context.getPackageName();
        params.setTitle("FNaF 2 Companion teach panel");
        // Readers are withheld from the moment the panel can be composited.
        teachDetachedAtNs = 0L;
        teachAttached = true;
        try {
            windowManager.addView(panel, params);
            teachView = panel;
            setTeachState("RUNNING:" + lesson.id);
        } catch (RuntimeException error) {
            Log.e("FnafCueHelper", "teach panel attach failed", error);
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
        if (current != null && windowManager != null) {
            try {
                windowManager.removeViewImmediate(current);
            } catch (RuntimeException ignored) {
                // Teardown is idempotent if WindowManager already detached it.
            }
        }
    }

    /** Publish a teach state change once, not once per captured frame. */
    private void setTeachState(String next) {
        if (next.equals(teachState)) return;
        teachState = next;
        emit(state);
    }

    private void stopTeachNow(String next) {
        teachRunning = false;
        teachLesson = null;
        teachState = next;
        detachTeach();
    }

    /**
     * Start an explicit debug-only sensor renderer probe for P5 evidence.
     * This is not a qualification bypass: it cannot render decision cues and
     * never writes the reviewed qualification sidecar.
     */
    public void startQualificationProbe() {
        if ((context.getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
            qualificationProbe = false;
            emit("ERROR(probe-release-build)");
            return;
        }
        if (!permissionGranted()) {
            qualificationProbe = false;
            detach(null);
            emit("DISABLED(permission)");
            return;
        }
        qualificationProbe = true;
        mode = OverlaySnapshot.Mode.SENSOR_DEBUG;
        preferences.edit().putString(PREF_MODE, "debug").apply();
        latestDecisionSnapshot = null;
        if (captureActive) {
            attachIfAllowed();
        } else {
            emit("READY");
        }
    }

    public void stopQualificationProbe() {
        qualificationProbe = false;
        latestDecisionSnapshot = null;
        if (captureActive) {
            if (captureGate.qualified && enabled()) {
                attachIfAllowed();
            } else {
                detach("self-capture-unqualified");
            }
        } else {
            emit(permissionGranted() ? "READY" : "DISABLED(permission)");
        }
    }

    public boolean wantsDebugSamples() {
        // Keep native identity-rescue samples alive during the debug probe's
        // short hidden interval; otherwise a detached window cannot observe
        // the persistent bottom controls needed to reattach itself.
        return mode == OverlaySnapshot.Mode.SENSOR_DEBUG
                && ((windowAttached && view != null) || qualificationProbe);
    }

    public boolean visible() {
        if (windowAttached && !permissionGranted()) {
            detach(null);
            emit("DISABLED(permission)");
            return false;
        }
        return windowAttached && view != null;
    }

    public void setMode(OverlaySnapshot.Mode mode) {
        if (mode == null) throw new IllegalArgumentException("overlay mode is null");
        if (qualificationProbe && mode == OverlaySnapshot.Mode.DECISION_RUN) {
            mode = OverlaySnapshot.Mode.SENSOR_DEBUG;
        }
        if (this.mode != mode) latestDecisionSnapshot = null;
        this.mode = mode;
        preferences.edit().putString(PREF_MODE,
                mode == OverlaySnapshot.Mode.DECISION_RUN ? "run" : "debug").apply();
        OverlayView current = view;
        if (current != null && windowAttached) {
            OverlaySnapshot next = mode == OverlaySnapshot.Mode.DECISION_RUN
                    ? latestDecisionSnapshot : null;
            updateViewSnapshot(current, next == null
                    ? OverlaySnapshot.empty(0L, System.nanoTime(), mode) : next);
        }
        emit(state);
    }

    /** Called only by a retained qualification harness, never by raw capture. */
    public void setCaptureGate(OverlayCaptureGate gate) {
        if (gate == null || !contract.profileId.equals(gate.profileId)
                || !gate.qualified
                || !targetBuildMatches(gate.targetPackage, gate.targetBuild)) {
            captureGate = OverlayCaptureGate.unqualified(contract.profileId);
        } else {
            captureGate = gate;
        }
        if (captureActive) {
            if (captureGate.qualified || qualificationProbe) attachIfAllowed();
            else detach("self-capture-unqualified");
        }
    }

    public void enable() {
        preferences.edit().putBoolean(PREF_ENABLED, true).apply();
        if (!permissionGranted()) {
            detach(null);
            emit("DISABLED(permission)");
            return;
        }
        if (captureActive && !captureGate.qualified && !qualificationProbe) {
            emit("DISABLED(self-capture-unqualified)");
        } else if (captureActive) {
            attachIfAllowed();
        } else {
            emit("READY");
        }
    }

    public void disable() {
        preferences.edit().putBoolean(PREF_ENABLED, false).apply();
        qualificationProbe = false;
        latestDecisionSnapshot = null;
        stopTeachNow("OFF");
        detach(null);
        emit(permissionGranted() ? "READY" : "DISABLED(permission)");
    }

    public void onCaptureStarted(int width, int height) {
        captureActive = true;
        capturedRecognizedIdentity = false;
        lastRecognizedIdentityNs = 0L;
        mainHandler.removeCallbacks(identityLossRunnable);
        metrics.reset();
        latestDecisionSnapshot = null;
        captureWidth = width;
        captureHeight = height;
        targetVisibility = -1;
        if (!enabled() && !qualificationProbe) {
            emit(permissionGranted() ? "READY" : "DISABLED(permission)");
        } else if (!permissionGranted()) {
            detach(null);
            emit("DISABLED(permission)");
        } else if (!captureGate.qualified && !qualificationProbe) {
            detach("self-capture-unqualified");
        } else {
            // Wait for a positive captured game identity before creating the
            // window. This avoids a helper/foreign frame briefly showing a HUD.
            emit("READY");
        }
    }

    public void onCaptureResized(int width, int height) {
        if (width < 1 || height < 1) return;
        captureWidth = width;
        captureHeight = height;
        if (view != null && windowAttached) {
            OverlayView current = view;
            if (!isMainThread()) {
                mainHandler.post(() -> {
                    if (windowAttached && view == current) {
                        current.setTransform(currentTransform());
                    }
                });
            } else {
                current.setTransform(currentTransform());
            }
        }
    }

    public void onTargetVisibilityChanged(int visibility) {
        if (!isMainThread()) {
            mainHandler.post(() -> onTargetVisibilityChanged(visibility));
            return;
        }
        targetVisibility = visibility;
        if (!captureActive || (!enabled() && !qualificationProbe)) return;
        if (visibility == 0) {
            capturedRecognizedIdentity = false;
            lastRecognizedIdentityNs = 0L;
            mainHandler.removeCallbacks(identityLossRunnable);
            detach(null);
            emit("UNAVAILABLE(target-hidden) state=HIDDEN");
        } else if (visibility == 1) {
            if (capturedRecognizedIdentity) attachIfAllowed();
        }
    }

    /**
     * Full-display MediaProjection reports content visibility, not the
     * foreground package. Keep the HUD fail-closed until the captured frame
     * itself positively identifies a supported FNaF 2 screen.
     */
    public void onCapturedScreenIdentity(int identity) {
        if (!isMainThread()) {
            synchronized (mainQueueLock) {
                pendingCapturedIdentity = identity;
                if (capturedIdentityDispatchQueued) return;
                capturedIdentityDispatchQueued = true;
            }
            mainHandler.post(capturedIdentityDispatch);
            return;
        }
        if (!captureActive || (!enabled() && !qualificationProbe)) return;
        if (ScreenIdentity.isRecognizedGameScreen(identity)) {
            capturedRecognizedIdentity = true;
            lastRecognizedIdentityNs = System.nanoTime();
            mainHandler.removeCallbacks(identityLossRunnable);
            if (identity != ScreenIdentity.FNAF2_NIGHT) {
                // A previous run-mode cue must not survive a transition to a
                // lifecycle screen while the window remains attached.
                latestDecisionSnapshot = null;
                OverlayView current = view;
                if (current != null && windowAttached) {
                    updateViewSnapshot(current, OverlaySnapshot.empty(
                            0L, System.nanoTime(), mode));
                }
            }
            attachIfAllowed();
        } else if (identity == ScreenIdentity.UNKNOWN) {
            // Point-sampled identity can miss a stable game frame for a few
            // callbacks. Keep the already-qualified window alive briefly, but
            // never restore it after the grace without another positive frame.
            if (capturedRecognizedIdentity && windowAttached) {
                mainHandler.removeCallbacks(identityLossRunnable);
                mainHandler.postDelayed(identityLossRunnable,
                        IDENTITY_LOSS_GRACE_NS / 1_000_000L);
            }
        } else {
            capturedRecognizedIdentity = false;
            lastRecognizedIdentityNs = 0L;
            mainHandler.removeCallbacks(identityLossRunnable);
            if (windowAttached) detach(null);
            emit("UNAVAILABLE(target-not-game) state=HIDDEN");
        }
    }

    private void drainCapturedIdentity() {
        if (!isMainThread()) {
            mainHandler.post(capturedIdentityDispatch);
            return;
        }
        int identity;
        synchronized (mainQueueLock) {
            identity = pendingCapturedIdentity;
            pendingCapturedIdentity = NO_PENDING_IDENTITY;
            capturedIdentityDispatchQueued = false;
        }
        if (identity != NO_PENDING_IDENTITY) {
            onCapturedScreenIdentity(identity);
        }
        boolean repost;
        synchronized (mainQueueLock) {
            repost = pendingCapturedIdentity != NO_PENDING_IDENTITY
                    && !capturedIdentityDispatchQueued;
            if (repost) capturedIdentityDispatchQueued = true;
        }
        if (repost) mainHandler.post(capturedIdentityDispatch);
    }

    public void onCaptureStopped() {
        captureActive = false;
        capturedRecognizedIdentity = false;
        lastRecognizedIdentityNs = 0L;
        mainHandler.removeCallbacks(identityLossRunnable);
        clearPendingMainWork();
        qualificationProbe = false;
        latestDecisionSnapshot = null;
        targetVisibility = -1;
        // A new capture generation re-latches the onset; the origin is void.
        stopTeachNow("OFF");
        detach(null);
        emit(enabled() && permissionGranted() ? "READY"
                : permissionGranted() ? "READY" : "DISABLED(permission)");
    }

    public void destroy() {
        captureActive = false;
        capturedRecognizedIdentity = false;
        lastRecognizedIdentityNs = 0L;
        mainHandler.removeCallbacks(identityLossRunnable);
        clearPendingMainWork();
        qualificationProbe = false;
        stopTeachNow("OFF");
        detach(null);
        emit(permissionGranted() ? "READY" : "DISABLED(permission)");
    }

    public void publishSensorSnapshot(OverlaySnapshot snapshot) {
        if (snapshot == null) return;
        if (snapshot.mode != OverlaySnapshot.Mode.SENSOR_DEBUG
                || mode != OverlaySnapshot.Mode.SENSOR_DEBUG
                || !captureActive || !windowAttached) return;
        metrics.onSnapshot(snapshot.sequence, System.nanoTime());
        OverlayView current = view;
        updateViewSnapshot(current, snapshot);
    }

    /** Accept only a validated snapshot from the fused belief/decision producer. */
    public void publishDecisionSnapshot(OverlaySnapshot snapshot) {
        if (snapshot == null || snapshot.mode != OverlaySnapshot.Mode.DECISION_RUN
                || !captureActive || !captureGate.qualified) return;
        OverlaySnapshot previous = latestDecisionSnapshot;
        if (previous != null && snapshot.sequence <= previous.sequence) return;
        latestDecisionSnapshot = snapshot;
        if (mode != OverlaySnapshot.Mode.DECISION_RUN) return;
        metrics.onSnapshot(snapshot.sequence, System.nanoTime());
        OverlayView current = view;
        updateViewSnapshot(current, snapshot);
    }

    /** Compatibility entry point that cannot promote a sensor fact to a cue. */
    public void publish(OverlaySnapshot snapshot) {
        if (snapshot == null) return;
        if (snapshot.mode == OverlaySnapshot.Mode.DECISION_RUN) {
            publishDecisionSnapshot(snapshot);
        } else {
            publishSensorSnapshot(snapshot);
        }
    }

    private void attachIfAllowed() {
        if (!isMainThread()) {
            mainHandler.post(this::attachIfAllowed);
            return;
        }
        if (!captureActive) {
            detach(null);
            emit(permissionGranted() ? "READY" : "DISABLED(permission)");
            return;
        }
        if (teachAttached) {
            // The teach panel holds the one overlay window for this night.
            detach("teach-active");
            return;
        }
        if ((!enabled() && !qualificationProbe) || !permissionGranted()) {
            emit(permissionGranted() ? "READY" : "DISABLED(permission)");
            return;
        }
        if (!capturedRecognizedIdentity) {
            if (windowAttached) detach(null);
            return;
        }
        if (!captureGate.qualified && !qualificationProbe) {
            detach("self-capture-unqualified");
            return;
        }
        if (targetVisibility == 0) {
            detach(null);
            emit("UNAVAILABLE(target-hidden) state=HIDDEN");
            return;
        }
        if (view != null) {
            String nextState = targetVisibility == 0
                    ? "UNAVAILABLE(target-hidden) state=HIDDEN"
                    : qualificationProbe ? "PROBE" : "VISIBLE";
            if (!nextState.equals(state)) emit(nextState);
            return;
        }
        if (windowManager == null) {
            emit("ERROR(window-manager-unavailable)");
            return;
        }
        boolean windowAdded = false;
        try {
            OverlayGeometry.Transform transform = currentTransform();
            view = new OverlayView(context, contract, transform, metrics::onRendered,
                    this::onWindowVisibilityChanged, OverlayGeometry.defaultHudMap());
            view.setSnapshot(latestDecisionSnapshot != null
                    && mode == OverlaySnapshot.Mode.DECISION_RUN
                    ? latestDecisionSnapshot
                    : OverlaySnapshot.empty(0L, System.nanoTime(), mode));
            view.setOnApplyWindowInsetsListener((ignored, insets) -> {
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets safe = insets.getInsets(
                            android.view.WindowInsets.Type.systemBars()
                                    | android.view.WindowInsets.Type.displayCutout());
                    updateDisplayInsets(safe.left, safe.top, safe.right, safe.bottom);
                }
                return insets;
            });
            layoutParams = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            layoutParams.gravity = Gravity.TOP | Gravity.START;
            if (Build.VERSION.SDK_INT >= 30) {
                // This overlay is drawn in the same edge-to-edge landscape
                // buffer as MediaProjection. The default application-overlay
                // policy fits system insets first. On this Moto g56 the
                // landscape camera cutout then shrinks the view to 2285 px
                // and places it at x=115. That is a WindowManager coordinate
                // translation, not game content geometry; opt out so the
                // canvas is 2400x1080 at 0,0.
                layoutParams.setFitInsetsTypes(0);
            }
            if (Build.VERSION.SDK_INT >= 28) {
                // The game itself is already rendered through the cutout and
                // MediaProjection captures those pixels, so the overlay must
                // share that edge-to-edge coordinate space.
                layoutParams.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            }
            layoutParams.alpha = touchThroughAlpha();
            layoutParams.packageName = context.getPackageName();
            layoutParams.setTitle("FNaF 2 Companion HUD");
            windowManager.addView(view, layoutParams);
            windowAdded = true;
            windowAttached = true;
            view.post(view::requestApplyInsets);
            registerDisplayListener();
            emit(targetVisibility == 0
                    ? "UNAVAILABLE(target-hidden) state=HIDDEN"
                    : qualificationProbe ? "PROBE" : "VISIBLE");
        } catch (SecurityException error) {
            Log.e("FnafCueHelper", "overlay attach denied", error);
            if (windowAdded) removeAttachedView();
            unregisterDisplayListener();
            windowAttached = false;
            view = null;
            layoutParams = null;
            emit("ERROR(permission-revoked)");
        } catch (RuntimeException error) {
            Log.e("FnafCueHelper", "overlay attach failed", error);
            if (windowAdded) removeAttachedView();
            unregisterDisplayListener();
            windowAttached = false;
            view = null;
            layoutParams = null;
            emit("ERROR(" + error.getClass().getSimpleName() + ")");
        }
    }

    private void detach(String reason) {
        if (!isMainThread()) {
            mainHandler.post(() -> detach(reason));
            return;
        }
        OverlayView current = view;
        windowAttached = false;
        view = null;
        layoutParams = null;
        synchronized (mainQueueLock) {
            pendingSnapshotView = null;
            pendingSnapshot = null;
        }
        // A detached window must never resurrect an old imperative cue after
        // target hiding, permission/display loss, or any other lifecycle gap.
        latestDecisionSnapshot = null;
        if (current != null && windowManager != null) {
            try {
                windowManager.removeViewImmediate(current);
            } catch (RuntimeException ignored) {
                // Teardown is idempotent if WindowManager already detached it.
            }
        }
        unregisterDisplayListener();
        if (reason != null) {
            emit("DISABLED(" + reason + ")");
        }
    }

    private void removeAttachedView() {
        if (view == null || windowManager == null) return;
        try {
            windowManager.removeViewImmediate(view);
        } catch (RuntimeException ignored) {
            // The add may have been rejected after partial registration.
        }
    }

    private OverlayCaptureGate loadQualificationRecord() {
        File record = new File(context.getFilesDir(),
                "overlay-qualification.properties");
        if (!record.isFile() || record.length() <= 0L || record.length() > 8_192L) {
            return OverlayCaptureGate.unqualified(contract.profileId);
        }
        byte[] bytes = new byte[(int) record.length()];
        try (FileInputStream input = new FileInputStream(record)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            if (offset != bytes.length) {
                return OverlayCaptureGate.unqualified(contract.profileId);
            }
            OverlayCaptureGate loaded = OverlayCaptureGate.fromRecord(
                    new String(bytes, StandardCharsets.US_ASCII));
            return contract.profileId.equals(loaded.profileId) && loaded.qualified
                    && targetBuildMatches(loaded.targetPackage, loaded.targetBuild)
                    ? loaded : OverlayCaptureGate.unqualified(contract.profileId);
        } catch (IOException | RuntimeException error) {
            return OverlayCaptureGate.unqualified(contract.profileId);
        }
    }

    private boolean targetBuildMatches(String targetPackage, String targetBuild) {
        if (!"com.scottgames.fnaf2".equals(targetPackage)
                || targetBuild == null || targetBuild.isEmpty()) return false;
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(
                    targetPackage, 0);
            String versionName = info.versionName == null ? "" : info.versionName;
            return (info.getLongVersionCode() + ":" + versionName).equals(targetBuild);
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            return false;
        }
    }

    private OverlayGeometry.Transform currentTransform() {
        // The service deliberately keeps an application context. On Android
        // 12+ Context#getDisplay() throws for that context rather than
        // returning null, so use the WindowManager's physical default display
        // first and only query a visual context when one is actually present.
        Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
        if (display == null && Build.VERSION.SDK_INT >= 30) {
            try {
                display = context.getDisplay();
            } catch (UnsupportedOperationException ignored) {
                // Application contexts are not associated with a display.
            }
        }
        DisplayMetrics metrics = new DisplayMetrics();
        if (display != null) display.getRealMetrics(metrics);
        int width = metrics.widthPixels > 0 ? metrics.widthPixels : captureWidth;
        int height = metrics.heightPixels > 0 ? metrics.heightPixels : captureHeight;
        OverlayGeometry.Rotation rotation = OverlayGeometry.Rotation.ROTATION_0;
        if (display != null) {
            switch (display.getRotation()) {
                case Surface.ROTATION_90:
                    rotation = OverlayGeometry.Rotation.ROTATION_90;
                    break;
                case Surface.ROTATION_180:
                    rotation = OverlayGeometry.Rotation.ROTATION_180;
                    break;
                case Surface.ROTATION_270:
                    rotation = OverlayGeometry.Rotation.ROTATION_270;
                    break;
                default:
                    break;
            }
        }
        rotation = OverlayGeometry.resolveContentRotation(width, height,
                captureWidth, captureHeight, rotation);
        // FNaF2 renders edge-to-edge into the same full-display 2400x1080
        // surface that MediaProjection captures. System-bar insets describe
        // safe touch/content areas, not a translation of the game pixels; do
        // not apply them or every ROI shifts into its neighbour.
        return new OverlayGeometry.Transform(contract.profileId,
                new OverlayGeometry.Viewport(0, 0, captureWidth, captureHeight,
                        OverlayGeometry.Rotation.ROTATION_0),
                new OverlayGeometry.Viewport(0, 0, width, height, rotation));
    }

    private void updateDisplayInsets(int left, int top, int right, int bottom) {
        insetLeft = Math.max(0, left);
        insetTop = Math.max(0, top);
        insetRight = Math.max(0, right);
        insetBottom = Math.max(0, bottom);
        if (view != null) view.setTransform(currentTransform());
    }

    private void updateViewSnapshot(OverlayView target, OverlaySnapshot snapshot) {
        if (target == null || snapshot == null) return;
        if (!isMainThread()) {
            synchronized (mainQueueLock) {
                pendingSnapshotView = target;
                pendingSnapshot = snapshot;
                if (snapshotDispatchQueued) return;
                snapshotDispatchQueued = true;
            }
            mainHandler.post(snapshotDispatch);
            return;
        }
        if (windowAttached && view == target) {
            target.setSnapshot(snapshot);
        }
    }

    private void drainSnapshot() {
        if (!isMainThread()) {
            mainHandler.post(snapshotDispatch);
            return;
        }
        OverlayView target;
        OverlaySnapshot snapshot;
        synchronized (mainQueueLock) {
            target = pendingSnapshotView;
            snapshot = pendingSnapshot;
            pendingSnapshotView = null;
            pendingSnapshot = null;
            snapshotDispatchQueued = false;
        }
        if (target != null && snapshot != null
                && windowAttached && view == target) {
            target.setSnapshot(snapshot);
        }
        boolean repost;
        synchronized (mainQueueLock) {
            repost = pendingSnapshot != null && !snapshotDispatchQueued;
            if (repost) snapshotDispatchQueued = true;
        }
        if (repost) mainHandler.post(snapshotDispatch);
    }

    private void clearPendingMainWork() {
        mainHandler.removeCallbacks(capturedIdentityDispatch);
        mainHandler.removeCallbacks(snapshotDispatch);
        synchronized (mainQueueLock) {
            pendingCapturedIdentity = NO_PENDING_IDENTITY;
            capturedIdentityDispatchQueued = false;
            pendingSnapshotView = null;
            pendingSnapshot = null;
            snapshotDispatchQueued = false;
        }
    }

    private boolean isMainThread() {
        return Looper.myLooper() == Looper.getMainLooper();
    }

    private void onWindowVisibilityChanged(boolean visible) {
        if (visible || !windowAttached || !captureActive || view == null) return;
        if (!permissionGranted()) {
            detach(null);
            emit("DISABLED(permission)");
            return;
        }
        // This is also the detection path for an Android 12+ target that
        // suppresses application overlays while remaining the capture target.
        capturedRecognizedIdentity = false;
        lastRecognizedIdentityNs = 0L;
        mainHandler.removeCallbacks(identityLossRunnable);
        detach(null);
        emit("UNAVAILABLE(target-hidden) state=HIDDEN");
    }

    private void finishIdentityLoss() {
        if (!isMainThread()) {
            mainHandler.post(this::finishIdentityLoss);
            return;
        }
        if (!captureActive || !capturedRecognizedIdentity
                || lastRecognizedIdentityNs == 0L) return;
        if (System.nanoTime() - lastRecognizedIdentityNs < IDENTITY_LOSS_GRACE_NS) {
            mainHandler.postDelayed(identityLossRunnable,
                    IDENTITY_LOSS_GRACE_NS / 1_000_000L);
            return;
        }
        capturedRecognizedIdentity = false;
        lastRecognizedIdentityNs = 0L;
        detach(null);
        emit("UNAVAILABLE(target-not-game) state=HIDDEN");
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

    private float touchThroughAlpha() {
        float maximum = .8f;
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                InputManager input = context.getSystemService(InputManager.class);
                if (input != null) maximum = input.getMaximumObscuringOpacityForTouch();
            } catch (RuntimeException ignored) {
                // Keep the conservative known platform maximum.
            }
        }
        return Math.max(.05f, Math.min(.75f, maximum - .05f));
    }

    private boolean permissionGranted() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    private int defaultDisplayId() {
        // The service deliberately owns an application context, which is not
        // associated with a display on Android 12+. The WindowManager display
        // is the stable source for display-listener comparisons.
        Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
        if (display == null && Build.VERSION.SDK_INT >= 30) {
            try {
                display = context.getDisplay();
            } catch (UnsupportedOperationException ignored) {
                // Application contexts are not associated with a display.
            }
        }
        return display == null ? Display.DEFAULT_DISPLAY : display.getDisplayId();
    }

    private void registerDisplayListener() {
        if (displayListenerRegistered || displayManager == null) return;
        displayManager.registerDisplayListener(displayListener, null);
        displayListenerRegistered = true;
    }

    private void unregisterDisplayListener() {
        if (!displayListenerRegistered || displayManager == null) return;
        displayManager.unregisterDisplayListener(displayListener);
        displayListenerRegistered = false;
    }

    private void emit(String next) {
        state = next;
        if (listener != null) listener.onOverlayStateChanged(status());
    }
}
