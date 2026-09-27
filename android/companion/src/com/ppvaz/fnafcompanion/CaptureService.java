package com.ppvaz.fnafcompanion;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.hardware.HardwareBuffer;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import android.graphics.Bitmap;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;


public final class CaptureService extends Service {
    public static final String ACTION_START =
            "com.fnaf2.cuehelper.action.START";
    public static final String ACTION_QUERY_STATUS =
            "com.fnaf2.cuehelper.action.QUERY_STATUS";
    public static final String ACTION_OVERLAY_ENABLE =
            "com.fnaf2.cuehelper.action.OVERLAY_ENABLE";
    public static final String ACTION_OVERLAY_DISABLE =
            "com.fnaf2.cuehelper.action.OVERLAY_DISABLE";
    public static final String ACTION_OVERLAY_MODE =
            "com.fnaf2.cuehelper.action.OVERLAY_MODE";
    public static final String ACTION_OVERLAY_PROBE_START =
            "com.fnaf2.cuehelper.action.OVERLAY_PROBE_START";
    public static final String ACTION_OVERLAY_PROBE_STOP =
            "com.fnaf2.cuehelper.action.OVERLAY_PROBE_STOP";
    public static final String ACTION_STOP =
            "com.fnaf2.cuehelper.action.STOP";
    public static final String ACTION_STATUS =
            "com.fnaf2.cuehelper.action.STATUS";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_CAPTURE_WIDTH = "captureWidth";
    public static final String EXTRA_CAPTURE_HEIGHT = "captureHeight";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_OVERLAY_MODE = "overlayMode";

    private static final String TAG = "FnafCueHelper";
    private static final String NOTIFICATION_CHANNEL = "capture";
    private static final int NOTIFICATION_ID = 7007;

    private static final int VISUAL_WIDTH = 20;
    private static final int VISUAL_HEIGHT = 9;
    private static final int VISUAL_X = 3;
    private static final int VISUAL_Y = 6;
    // The CAM 05 feed region is a block of the same 20x9 frame
    // (PixelWatch.CAM05_CELL_*). Reading it costs pixels of an image the
    // service already has -- the reason CAM 05 needed a 206 ms screencap was
    // that this service sampled exactly one hardcoded point, not any limit of
    // the capture.
    private static final long MAX_VISUAL_FRAME_AGE_US = 250_000L;
    private static final long VISUAL_REPORT_INTERVAL_NS = 1_000_000_000L;
    private static final int CONTROL_PORT = 49_707;
    private static final String CONTROL_SOCKET_PREFIX =
            "com.fnaf2.cuehelper.control";
    private static final int CONTROL_LINE_LIMIT = 256;
    private static final int CONTROL_READ_TIMEOUT_MS = 1_000;
    // Keep enough rows for a complete ten-minute night at 60 Hz. At native
    // 2400x1080 the retained 20x9 grid plus the calibrated control values is
    // about 27 MB, which is materially cheaper than retaining image buffers.
    // The trace is written only after STOP, on the control thread.
    private static final int FRAME_TRACE_MAX_FRAMES = 36_000;
    private static final int FRAME_TRACE_GRID_CELLS = VISUAL_WIDTH * VISUAL_HEIGHT;
    // Three native RGBA buffers are enough for acquireLatestImage and keep the
    // projection from reserving roughly 80 MB for eight 2400x1080 buffers.
    // Trace mode still consumes them in timestamp order; the callback must
    // remain below the 16.7 ms display budget to retain every presentation.
    private static final int IMAGE_READER_MAX_IMAGES = 3;

    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object snapshotLock = new Object();
    // Incremented for every start and stop. Worker callbacks from an older
    // projection must not observe or mutate a later session.
    private volatile long sessionGeneration;

    private MediaProjection projection;
    private MediaProjection.Callback projectionCallback;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread visualThread;
    private ServerSocket controlServer;
    private LocalServerSocket localControlServer;
    private Thread controlThread;
    private Thread localControlThread;
    private volatile boolean controlRunning;
    private volatile boolean tcpControlUp;
    private volatile boolean localControlUp;
    private String controlToken;
    private String controlSocketName;

    private long visualSequence;
    private long lastVisualReportNs;
    private volatile int capturedContentWidth;
    private volatile int capturedContentHeight;
    // The watchlist is native-resolution by contract. A small projection can
    // still be requested for the legacy GRID path or a latency probe, but a
    // native watch refuses to run against it rather than silently scaling a
    // calibrated coordinate into a different sensor.
    private int captureWidth = PixelWatch.NATIVE_WIDTH;
    private int captureHeight = PixelWatch.NATIVE_HEIGHT;
    // -1 is unknown, 0 is hidden, 1 is visible. The API-36 target must not
    // turn a letterboxed or hidden capture into a confident pixel reading.
    private volatile int capturedContentVisibility = -1;
    private volatile String lastVisual = "visual=UNAVAILABLE";
    private volatile String lastControl = "control=UNAVAILABLE";
    private OverlayController overlayController;

    private long snapshotVisualSequence;
    private long snapshotVisualTimestampNs;
    private int snapshotRed;
    private int snapshotGreen;
    private int snapshotBlue;
    private int snapshotLuma;
    private int snapshotCam05MeanLuma;
    private int snapshotScreenIdentity = ScreenIdentity.UNKNOWN;
    // Image time of this night's first held FNAF2_NIGHT frame, published in
    // GET/FRAME so the host can place the schedule release against the game's
    // own one-second grid instead of a ~1 Hz screenshot classifier.
    private final NightOnsetLatch nightOnsetLatch = new NightOnsetLatch();
    private final Object lessonLock = new Object();
    private CycleLesson.Builder pendingLesson;
    private int snapshotScreenScore;
    private long snapshotDetectorLatencyMs;
    // Native bottom-control means from the same image as the snapshot/grid.
    // These are kept separate from the trace columns so a lightweight GET can
    // gate an action without serializing the full 180-cell FRAME body.
    private int snapshotMaskButtonMeanLuma = PixelWatch.UNKNOWN;
    private int snapshotMonitorButtonMeanLuma = PixelWatch.UNKNOWN;
    // Fixed downward-chevron coverage from the same native image. The luma
    // fields above remain diagnostic only; a state gate must use these stroke
    // scores because the button bars are translucent.
    private int snapshotMaskButtonDownstroke = PixelWatch.UNKNOWN;
    private int snapshotMonitorButtonDownstroke = PixelWatch.UNKNOWN;
    // Near-grey cells over the whole grid, or -1 when the grid is incomplete.
    //
    // A whole-frame count, because this sensor point-samples: the position
    // anchors it defeats (the lit camera button, 7 of 12 cameras) cannot be
    // repaired by a threshold. See ScreenStats and ONE-PIXEL-VISION.md section 3.
    private int snapshotGreyCells = -1;
    // Whole-grid mean luma, or -1 when the grid is incomplete. A darkness
    // guard for calibrated consumers, not a verdict: see ScreenStats.meanLuma.
    private int snapshotGridMeanLuma = -1;
    // The whole 20x9 sensor, packed 0xRRGGBB per cell.
    //
    // The service already renders this grid every frame and was reporting one
    // pixel of it (3,6) plus one block mean. Everything else was discarded, so
    // nothing downstream could tell a Withered Freddy jumpscare from a dark
    // office: during one, the snapshot read luma 0-37 and a neutral grey
    // triple, because the single reported pixel happens to sit somewhere dark.
    // 180 cells is small enough to send on one line and is the whole picture
    // the helper has.
    //
    // Preallocated and filled in place: the 60 fps callback must not allocate,
    // which is why the first long-running probe accumulated heap pressure.
    private final int[] snapshotGrid = new int[VISUAL_WIDTH * VISUAL_HEIGHT];
    private final int[] frameTraceGrid = new int[FRAME_TRACE_GRID_CELLS];
    private boolean snapshotGridValid;
    private final PixelWatch.Spec watchSpec = PixelWatch.defaultSpec();
    private final PixelWatch.ByteBufferFrame watchFrame = new PixelWatch.ByteBufferFrame();
    // Raw native pixels of reader-registered regions, copied every native
    // frame (REGION verb). The observation primitive for new detectors.
    private final NativeRegions nativeRegions =
            new NativeRegions(PixelWatch.NATIVE_WIDTH, PixelWatch.NATIVE_HEIGHT);
    private long regionSequence;
    // One whole native frame on request (SNAP verb): the menu and title
    // readers' input, replacing the full-display screencap. Copied on the
    // capture thread, encoded on the control thread.
    private volatile CountDownLatch snapRequest;
    private int[] snapPixels;
    private long snapImageNs;
    private final int[] snapshotWatchValues = new int[PixelWatch.MAX_ENTRIES];
    private final PanAnchor.Workspace panAnchorWorkspace = new PanAnchor.Workspace();
    private final PanAnchor.Result framePanAnchor = new PanAnchor.Result();
    private int snapshotPanAnchorX = PanAnchor.UNKNOWN;
    private int snapshotPanAnchorY = PanAnchor.UNKNOWN;
    private int snapshotPanAnchorArea = PanAnchor.UNKNOWN;
    private int snapshotPanAnchorMargin = PanAnchor.UNKNOWN;
    private int snapshotPanAnchorConfidence;
    private String snapshotPanAnchorReason = "not-measured";
    private volatile boolean watchActive;
    private long lastOverlaySnapshotNs;
    private long overlaySequence;
    private final Object frameTraceLock = new Object();
    private volatile boolean frameTraceActive;
    private FrameTrace frameTrace;
    private volatile String lastFrameTrace = "trace=OFF";

    /**
     * Bounded, device-local visual trace. The Image timestamp and
     * System.nanoTime callback timestamp stay in the helper's monotonic
     * domain; the sampled grid and watch values are copied from that same
     * image before it is closed. No host polling is involved.
     */
    private static final class FrameTrace {
        private final String label;
        private final File file;
        private final long startNs;
        private final long startElapsedNs;
        private final long[] timestampNs = new long[FRAME_TRACE_MAX_FRAMES];
        private final long[] elapsedNs = new long[FRAME_TRACE_MAX_FRAMES];
        private final long[] callbackNs = new long[FRAME_TRACE_MAX_FRAMES];
        private final long[] intervalNs = new long[FRAME_TRACE_MAX_FRAMES];
        private final long[] sequence = new long[FRAME_TRACE_MAX_FRAMES];
        private final int[] grid = new int[FRAME_TRACE_MAX_FRAMES * FRAME_TRACE_GRID_CELLS];
        private final int[] maskLuma = new int[FRAME_TRACE_MAX_FRAMES];
        private final int[] monitorLuma = new int[FRAME_TRACE_MAX_FRAMES];
        private final int[] maskDownstroke = new int[FRAME_TRACE_MAX_FRAMES];
        private final int[] monitorDownstroke = new int[FRAME_TRACE_MAX_FRAMES];
        private final int[] screenIdentity = new int[FRAME_TRACE_MAX_FRAMES];
        private final int[] gridMeanLuma = new int[FRAME_TRACE_MAX_FRAMES];
        private int count;
        private long lastTimestampNs;
        private long maxIntervalNs;
        private int intervalsOver25ms;
        private boolean full;

        FrameTrace(String label, File file, long startNs, long startElapsedNs) {
            this.label = label;
            this.file = file;
            this.startNs = startNs;
            this.startElapsedNs = startElapsedNs;
        }

        boolean record(long imageTimestampNs, long imageElapsedNs, long imageCallbackNs,
                long visualSeq,
                int[] sourceGrid, int sourceMaskLuma, int sourceMonitorLuma,
                int sourceMaskDownstroke, int sourceMonitorDownstroke,
                int sourceScreenIdentity, int sourceGridMeanLuma) {
            // acquireNextImage may first return a frame that was queued just
            // before START. It is not part of this measurement window and
            // must not manufacture a false long interval at the front.
            if (imageTimestampNs < startNs) return true;
            if (count >= FRAME_TRACE_MAX_FRAMES) {
                full = true;
                return false;
            }
            int index = count++;
            timestampNs[index] = imageTimestampNs;
            elapsedNs[index] = imageElapsedNs;
            callbackNs[index] = imageCallbackNs;
            sequence[index] = visualSeq;
            intervalNs[index] = lastTimestampNs == 0L
                    ? 0L : Math.max(0L, imageTimestampNs - lastTimestampNs);
            if (intervalNs[index] > maxIntervalNs) maxIntervalNs = intervalNs[index];
            if (intervalNs[index] > 25_000_000L) intervalsOver25ms++;
            lastTimestampNs = imageTimestampNs;
            System.arraycopy(sourceGrid, 0, grid, index * FRAME_TRACE_GRID_CELLS,
                    FRAME_TRACE_GRID_CELLS);
            maskLuma[index] = sourceMaskLuma;
            monitorLuma[index] = sourceMonitorLuma;
            maskDownstroke[index] = sourceMaskDownstroke;
            monitorDownstroke[index] = sourceMonitorDownstroke;
            screenIdentity[index] = sourceScreenIdentity;
            gridMeanLuma[index] = sourceGridMeanLuma;
            return true;
        }

        String write() throws IOException {
            try (FileOutputStream output = new FileOutputStream(file, false)) {
                String header = "# schema=fnaf2-frame-trace-v3"
                        + " image_clock=helper-monotonic-ns"
                        + " elapsed_clock=android-elapsed-realtime-ns"
                        + " image_timestamp=Image.getTimestamp"
                        + " acquisition=ImageReader.acquireNextImage"
                        + " max_images=" + IMAGE_READER_MAX_IMAGES
                        + " capture=2400x1080"
                        + " grid=20x9"
                        + " watch_spec=" + PixelWatch.defaultSpec().sha256()
                        + " start_ns=" + startNs
                        + " start_elapsed_ns=" + startElapsedNs
                        + " label=" + label + "\n"
                        + "seq\timage_ns\telapsed_ns\tcallback_ns\tinterval_ns"
                        + "\tgrid_mean_luma\tscreen_identity\tmask_luma"
                        + "\tmonitor_luma\tmask_downstroke\tmonitor_downstroke"
                        + "\tgrid_hex\n";
                output.write(header.getBytes(StandardCharsets.US_ASCII));
                for (int index = 0; index < count; index++) {
                    StringBuilder line = new StringBuilder(1_400);
                    line.append(sequence[index]).append('\t')
                            .append(timestampNs[index]).append('\t')
                            .append(elapsedNs[index]).append('\t')
                            .append(callbackNs[index]).append('\t')
                            .append(intervalNs[index]).append('\t')
                            .append(gridMeanLuma[index]).append('\t')
                            .append(screenIdentity[index]).append('\t')
                            .append(maskLuma[index]).append('\t')
                            .append(monitorLuma[index]).append('\t')
                            .append(maskDownstroke[index]).append('\t')
                            .append(monitorDownstroke[index]).append('\t');
                    int offset = index * FRAME_TRACE_GRID_CELLS;
                    for (int cell = 0; cell < FRAME_TRACE_GRID_CELLS; cell++) {
                        int rgb = grid[offset + cell];
                        line.append(HEX[(rgb >> 20) & 0xf])
                                .append(HEX[(rgb >> 16) & 0xf])
                                .append(HEX[(rgb >> 12) & 0xf])
                                .append(HEX[(rgb >> 8) & 0xf])
                                .append(HEX[(rgb >> 4) & 0xf])
                                .append(HEX[rgb & 0xf]);
                    }
                    line.append('\n');
                    output.write(line.toString().getBytes(StandardCharsets.US_ASCII));
                }
            }
            return file.getName();
        }

        String status(String state) {
            return "trace=" + state + " label=" + label + " file=" + file.getName()
                    + " frames=" + count + " maxFrames=" + FRAME_TRACE_MAX_FRAMES
                    + " full=" + full + " maxIntervalNs=" + maxIntervalNs
                    + " intervalsOver25ms=" + intervalsOver25ms
                    + " startNs=" + startNs
                    + " startElapsedNs=" + startElapsedNs;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        overlayController = new OverlayController(this,
                state -> publishCombinedStatus("RUNNING"));
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL,
                "Companion capture",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Active on-device native frame capture");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_OVERLAY_ENABLE.equals(action)) {
            overlayController.enable();
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }
        if (ACTION_OVERLAY_DISABLE.equals(action)) {
            overlayController.disable();
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }
        if (ACTION_OVERLAY_MODE.equals(action)) {
            String requested = intent.getStringExtra(EXTRA_OVERLAY_MODE);
            overlayController.setMode("run".equalsIgnoreCase(requested)
                    ? OverlaySnapshot.Mode.DECISION_RUN
                    : OverlaySnapshot.Mode.SENSOR_DEBUG);
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }
        if (ACTION_OVERLAY_PROBE_START.equals(action)) {
            overlayController.startQualificationProbe();
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }
        if (ACTION_OVERLAY_PROBE_STOP.equals(action)) {
            overlayController.stopQualificationProbe();
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            stopCapture("operator-stop", true);
            // Keep the service instance alive and idle. The next start gets a
            // fresh consent token and can reuse this process immediately.
            return START_NOT_STICKY;
        }

        if (ACTION_QUERY_STATUS.equals(action)) {
            publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING");
            return START_NOT_STICKY;
        }

        if (!ACTION_START.equals(action)) {
            publishStatus("UNAVAILABLE: no active projection session");
            return START_NOT_STICKY;
        }

        startForegroundNow();
        if (projection != null) {
            publishCombinedStatus("RUNNING");
            return START_NOT_STICKY;
        }

        stopping.set(false);
        final long generation = ++sessionGeneration;

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultCode != Activity.RESULT_OK || resultData == null) {
            failAndStop("invalid-projection-consent");
            return START_NOT_STICKY;
        }

        try {
            MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
            projection = manager.getMediaProjection(resultCode, resultData);
            projectionCallback = new MediaProjection.Callback() {
                @Override
                public void onCapturedContentResize(int width, int height) {
                    if (!sessionActive(generation)) return;
                    capturedContentWidth = width;
                    capturedContentHeight = height;
                    if (overlayController != null) {
                        overlayController.onCaptureResized(width, height);
                    }
                    Log.i(TAG, "captured content resized: " + width + "x" + height);
                }

                @Override
                public void onCapturedContentVisibilityChanged(boolean isVisible) {
                    if (!sessionActive(generation)) return;
                    capturedContentVisibility = isVisible ? 1 : 0;
                    if (overlayController != null) {
                        overlayController.onTargetVisibilityChanged(
                                isVisible ? 1 : 0);
                    }
                    Log.i(TAG, "captured content visible=" + isVisible);
                }

                @Override
                public void onStop() {
                    if (!sessionActive(generation)) return;
                    Log.w(TAG, "projection callback: stopped");
                    stopCapture("projection-stopped", false);
                    stopSelf();
                }
            };
            projection.registerCallback(projectionCallback, mainHandler);
            captureWidth = intent.getIntExtra(EXTRA_CAPTURE_WIDTH,
                    PixelWatch.NATIVE_WIDTH);
            captureHeight = intent.getIntExtra(EXTRA_CAPTURE_HEIGHT,
                    PixelWatch.NATIVE_HEIGHT);
            if (!validCaptureSize(captureWidth, captureHeight)) {
                throw new IllegalArgumentException("capture size must be a 20:9 "
                        + "landscape size between 20x9 and 2400x1080");
            }
            overlayController.onCaptureStarted(captureWidth, captureHeight);
            lastOverlaySnapshotNs = 0L;
            startVisualCapture(generation);
            startControlServer(generation);
            publishControlStatus();
            publishCombinedStatus("RUNNING");
        } catch (Throwable error) {
            Log.e(TAG, "capture startup failed", error);
            failAndStop("startup-" + error.getClass().getSimpleName());
        }
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        Intent activityIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                0,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, NOTIFICATION_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("FNaF Companion capture")
                .setContentText("Native frames for registered regions")
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startVisualCapture(long generation) {
        nightOnsetLatch.reset();
        visualThread = new HandlerThread(
                "cue-visual",
                Process.THREAD_PRIORITY_DISPLAY);
        visualThread.start();
        Handler visualHandler = new Handler(visualThread.getLooper());

        imageReader = ImageReader.newInstance(
                captureWidth,
                captureHeight,
                PixelFormat.RGBA_8888,
                IMAGE_READER_MAX_IMAGES,
                HardwareBuffer.USAGE_CPU_READ_OFTEN);
        imageReader.setOnImageAvailableListener(
                reader -> onImageAvailable(reader, generation), visualHandler);

        int densityDpi = getResources().getConfiguration().densityDpi;
        virtualDisplay = projection.createVirtualDisplay(
                "Minus7Visual",
                captureWidth,
                captureHeight,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                new VirtualDisplay.Callback() {
                    @Override
                    public void onStopped() {
                        if (!sessionActive(generation)) return;
                        lastVisual = "visual=UNAVAILABLE(display-stopped)";
                        publishCombinedStatus("UNAVAILABLE");
                    }
                },
                visualHandler);

        if (virtualDisplay == null) {
            throw new IllegalStateException("createVirtualDisplay returned null");
        }
        lastVisual = "visual=STARTING(" + captureWidth + "x" + captureHeight
                + ",legacy-grid=20x9,watch-spec=" + watchSpec.sha256() + ")";
        Log.i(TAG, lastVisual);
    }

    private void onImageAvailable(ImageReader reader, long generation) {
        if (!sessionActive(generation)) return;
        Image image = null;
        boolean drainFrames = frameTraceActive;
        try {
            do {
                // Normal observation intentionally asks for the newest frame.
                // A frame trace is different: latest would discard the exact
                // presentation between two callbacks, so trace mode consumes
                // the queue in order and keeps each Image timestamp.
                image = drainFrames
                        ? reader.acquireNextImage() : reader.acquireLatestImage();
                if (image == null) {
                    return;
                }
                if (frameTraceActive
                        && captureWidth == PixelWatch.NATIVE_WIDTH
                        && captureHeight == PixelWatch.NATIVE_HEIGHT) {
                    recordTraceImage(image);
                    image.close();
                    image = null;
                    continue;
                }
            long detectorStartNs = System.nanoTime();
            Image.Plane[] planes = image.getPlanes();
            if (planes.length == 0) {
                lastVisual = "visual=UNAVAILABLE(no-plane)";
                return;
            }

            Image.Plane plane = planes[0];
            ByteBuffer buffer = plane.getBuffer();
            watchFrame.set(buffer, captureWidth, captureHeight,
                    plane.getRowStride(), plane.getPixelStride());
            if (captureWidth == PixelWatch.NATIVE_WIDTH
                    && captureHeight == PixelWatch.NATIVE_HEIGHT) {
                nativeRegions.capture(watchFrame, ++regionSequence,
                        image.getTimestamp(), System.nanoTime());
                CountDownLatch snap = snapRequest;
                if (snap != null && snap.getCount() > 0) {
                    copySnap(buffer, plane.getRowStride(), plane.getPixelStride(),
                            image.getTimestamp());
                    snap.countDown();
                }
            }
            // The bulb anchor is measured from the same native frame as the
            // watchlist. It is an observation only: ROI transformation still
            // requires a separately calibrated camera-position mapping.
            PanAnchor.measure(watchFrame, panAnchorWorkspace, framePanAnchor);
            int logicalX = PixelWatch.gridSampleX(VISUAL_X, captureWidth);
            int logicalY = PixelWatch.gridSampleY(VISUAL_Y, captureHeight);
            int rgb = watchFrame.rgb(logicalX, logicalY);
            if (rgb == PixelWatch.UNKNOWN) {
                lastVisual = "visual=UNAVAILABLE(bounds)";
                return;
            }
            int red = (rgb >> 16) & 0xff;
            int green = (rgb >> 8) & 0xff;
            int blue = rgb & 0xff;
            int luma = (77 * red + 150 * green + 29 * blue) >> 8;
            int cam05MeanLuma = PixelWatch.cam05BlockLuma(watchFrame);
            long callbackNs = System.nanoTime();
            long timestampNs = image.getTimestamp();
            long ageUs = timestampNs > 0 ? (callbackNs - timestampNs) / 1_000L : -1;
            if (ageUs < 0 || ageUs > 10_000_000L) {
                ageUs = -1;
            }
            visualSequence++;
            // Read once under the lock: the report below runs outside it, and
            // recomputing there would both duplicate the pass and race the
            // next frame's writer.
            int greyCells;
            int gridMeanLuma;
            int screenIdentity;
            int screenScore;
            PixelWatch.ControlState teachControl;
            // While the teach panel may be on screen, the two readers that
            // cannot avoid its rectangle are withheld (TeachPanelTest).
            boolean teachShown = overlayController != null
                    && overlayController.teachMayBeVisible(timestampNs);
            if (!sessionActive(generation)) return;
            synchronized (snapshotLock) {
                snapshotVisualSequence = visualSequence;
                snapshotVisualTimestampNs = timestampNs;
                snapshotRed = red;
                snapshotGreen = green;
                snapshotBlue = blue;
                snapshotLuma = luma;
                snapshotCam05MeanLuma = cam05MeanLuma;
                snapshotPanAnchorX = framePanAnchor.x;
                snapshotPanAnchorY = framePanAnchor.y;
                snapshotPanAnchorArea = framePanAnchor.area;
                snapshotPanAnchorMargin = framePanAnchor.margin;
                snapshotPanAnchorConfidence = framePanAnchor.confidence;
                snapshotPanAnchorReason = framePanAnchor.reason;
                boolean complete = true;
                for (int gy = 0; gy < VISUAL_HEIGHT; gy++) {
                    for (int gx = 0; gx < VISUAL_WIDTH; gx++) {
                        int x = PixelWatch.gridSampleX(gx, captureWidth);
                        int y = PixelWatch.gridSampleY(gy, captureHeight);
                        int cell = watchFrame.rgb(x, y);
                        if (cell == PixelWatch.UNKNOWN) {
                            complete = false;
                            break;
                        }
                        snapshotGrid[gy * VISUAL_WIDTH + gx] = cell;
                    }
                    if (!complete) {
                        break;
                    }
                }
                snapshotGridValid = complete;
                snapshotGreyCells = complete
                        ? ScreenStats.greyCells(snapshotGrid, snapshotGrid.length)
                        : -1;
                snapshotGridMeanLuma = complete
                        ? ScreenStats.meanLuma(snapshotGrid, snapshotGrid.length)
                        : -1;
                snapshotScreenIdentity = !complete ? ScreenIdentity.UNKNOWN
                        : teachShown ? ScreenIdentity.classify(snapshotGrid)
                        : ScreenIdentity.classify(watchFrame, snapshotGrid);
                snapshotScreenScore = complete
                        ? ScreenIdentity.score(snapshotGrid) : 0;
                if (captureWidth == PixelWatch.NATIVE_WIDTH
                        && captureHeight == PixelWatch.NATIVE_HEIGHT) {
                    snapshotMaskButtonMeanLuma = blockLuma(watchFrame,
                            PixelWatch.MASK_BUTTON_X, PixelWatch.MASK_BUTTON_Y,
                            PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH,
                            PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT,
                            PixelWatch.CONTROL_BUTTON_STEP);
                    snapshotMonitorButtonMeanLuma = blockLuma(watchFrame,
                            PixelWatch.MONITOR_BUTTON_X, PixelWatch.MONITOR_BUTTON_Y,
                            PixelWatch.MONITOR_BUTTON_X + PixelWatch.MONITOR_BUTTON_WIDTH,
                            PixelWatch.MONITOR_BUTTON_Y + PixelWatch.MONITOR_BUTTON_HEIGHT,
                            PixelWatch.CONTROL_BUTTON_STEP);
                    snapshotMaskButtonDownstroke = PixelWatch.controlDownStrokeScore(
                            watchFrame, true);
                    snapshotMonitorButtonDownstroke = PixelWatch.controlDownStrokeScore(
                            watchFrame, false);
                } else {
                    snapshotMaskButtonMeanLuma = PixelWatch.UNKNOWN;
                    snapshotMonitorButtonMeanLuma = PixelWatch.UNKNOWN;
                    snapshotMaskButtonDownstroke = PixelWatch.UNKNOWN;
                    snapshotMonitorButtonDownstroke = PixelWatch.UNKNOWN;
                }
                greyCells = snapshotGreyCells;
                gridMeanLuma = snapshotGridMeanLuma;
                screenScore = snapshotScreenScore;
                boolean overlayDebug = overlayController != null
                        && overlayController.wantsDebugSamples();
                if ((watchActive || overlayDebug)
                        && captureWidth == PixelWatch.NATIVE_WIDTH
                        && captureHeight == PixelWatch.NATIVE_HEIGHT) {
                    boolean readBattery = snapshotScreenIdentity == ScreenIdentity.FNAF2_NIGHT
                            && PixelWatch.controlState(
                                    snapshotMaskButtonDownstroke,
                                    snapshotMonitorButtonDownstroke)
                                    == PixelWatch.ControlState.OFFICE_UNMASKED;
                    PixelWatch.readInto(watchSpec, watchFrame,
                            snapshotWatchValues, readBattery);
                    int withheld = teachShown
                            ? watchSpec.indexOfName(TeachPanel.WITHHELD_WATCH_ENTRY) : -1;
                    if (withheld >= 0) snapshotWatchValues[withheld] = PixelWatch.UNKNOWN;
                } else {
                    for (int i = 0; i < watchSpec.size(); i++) {
                        snapshotWatchValues[i] = PixelWatch.UNKNOWN;
                    }
                }
                if (overlayDebug && snapshotScreenIdentity == ScreenIdentity.UNKNOWN) {
                    int maskIndex = watchSpec.indexOfName("mask_button_mean_luma");
                    int monitorIndex = watchSpec.indexOfName("monitor_button_mean_luma");
                    int maskLuma = maskIndex < 0
                            ? PixelWatch.UNKNOWN : snapshotWatchValues[maskIndex];
                    int monitorLuma = monitorIndex < 0
                            ? PixelWatch.UNKNOWN : snapshotWatchValues[monitorIndex];
                    snapshotScreenIdentity = ScreenIdentity.refineWithNativeControls(
                            snapshotScreenIdentity, maskLuma, monitorLuma);
                }
                screenIdentity = snapshotScreenIdentity;
                teachControl = PixelWatch.controlState(snapshotMaskButtonDownstroke,
                        snapshotMonitorButtonDownstroke);
                nightOnsetLatch.onFrame(timestampNs, screenIdentity);
                snapshotDetectorLatencyMs = Math.max(0L,
                        (System.nanoTime() - detectorStartNs) / 1_000_000L);
                if (frameTraceActive && captureWidth == PixelWatch.NATIVE_WIDTH
                        && captureHeight == PixelWatch.NATIVE_HEIGHT) {
                    int maskIndex = watchSpec.indexOfName("mask_button_mean_luma");
                    int monitorIndex = watchSpec.indexOfName("monitor_button_mean_luma");
                    recordFrameTrace(snapshotGrid, timestampNs,
                            SystemClock.elapsedRealtimeNanos(), callbackNs, visualSequence,
                            maskIndex < 0 ? PixelWatch.UNKNOWN : snapshotWatchValues[maskIndex],
                            monitorIndex < 0 ? PixelWatch.UNKNOWN : snapshotWatchValues[monitorIndex],
                            snapshotMaskButtonDownstroke, snapshotMonitorButtonDownstroke,
                            screenIdentity, gridMeanLuma);
                }
            }

            if (overlayController != null && overlayController.needsCapturedIdentity()) {
                overlayController.onCapturedScreenIdentity(screenIdentity);
            }
            if (overlayController != null && overlayController.teachRunning()) {
                overlayController.onTeachFrame(screenIdentity, teachControl);
            }

            if (overlayController != null && overlayController.visible()
                    && callbackNs - lastOverlaySnapshotNs >= 33_000_000L) {
                lastOverlaySnapshotNs = callbackNs;
                String overlayInvalidReason = ageUs < 0
                        ? "timestamp-invalid"
                        : ageUs > MAX_VISUAL_FRAME_AGE_US
                                ? "frame-stale" : capturedContentInvalidReason();
                publishOverlaySnapshot(callbackNs, overlayInvalidReason);
            }

            if (callbackNs - lastVisualReportNs >= VISUAL_REPORT_INTERVAL_NS) {
                lastVisualReportNs = callbackNs;
                // Keep the 60 fps hot path allocation-free. Formatting every
                // frame made the first long-running probe accumulate avoidable
                // heap/RSS pressure even though Image buffers were closed.
                String content = String.format(Locale.US, "%dx%d visible=%d",
                        capturedContentWidth,
                        capturedContentHeight,
                        capturedContentVisibility);
                String invalidReason = ageUs < 0
                        ? "timestamp-invalid"
                        : ageUs > MAX_VISUAL_FRAME_AGE_US
                                ? "frame-stale"
                                : capturedContentInvalidReason();
                if (invalidReason == null) {
                    lastVisual = String.format(Locale.US,
                            "visual=OBSERVED seq=%d rgba=%d,%d,%d luma=%d "
                                    + "cam05_mean_luma=%d grey=%d gridLuma=%d ageUs=%d content=%s "
                                    + "screen=%s screenScore=%d",
                            visualSequence, red, green, blue, luma, cam05MeanLuma,
                            greyCells, gridMeanLuma, ageUs, content,
                            ScreenIdentity.label(screenIdentity), screenScore);
                } else {
                    lastVisual = String.format(Locale.US,
                            "visual=UNKNOWN seq=%d reason=%s ageUs=%d content=%s "
                                    + "screen=UNKNOWN screenScore=0",
                            visualSequence, invalidReason, ageUs, content);
                }
                publishCombinedStatus("RUNNING");
            }
                if (drainFrames) {
                    image.close();
                    image = null;
                }
            } while (drainFrames && frameTraceActive && sessionActive(generation));
        } catch (Throwable error) {
            lastVisual = "visual=UNAVAILABLE(" + error.getClass().getSimpleName() + ")";
            Log.e(TAG, "visual frame failed", error);
            publishCombinedStatus("UNAVAILABLE");
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    /**
     * The trace path intentionally does not run the live detector stack. A
     * detector pass (pan anchor, identity, full watchlist) is useful for a
     * current-state read but can itself make an ImageReader observer lossy.
     * This path samples only the evidence retained in the trace and drains
     * every queued Image in timestamp order.
     */
    private void recordTraceImage(Image image) {
        long timestampNs = image.getTimestamp();
        long callbackNs = System.nanoTime();
        Image.Plane[] planes = image.getPlanes();
        if (planes.length == 0) {
            Arrays.fill(frameTraceGrid, PixelWatch.UNKNOWN);
            recordFrameTrace(frameTraceGrid, timestampNs,
                    SystemClock.elapsedRealtimeNanos(), callbackNs, ++visualSequence,
                    PixelWatch.UNKNOWN, PixelWatch.UNKNOWN,
                    PixelWatch.UNKNOWN, PixelWatch.UNKNOWN,
                    ScreenIdentity.UNKNOWN, PixelWatch.UNKNOWN);
            return;
        }
        Image.Plane plane = planes[0];
        watchFrame.set(plane.getBuffer(), captureWidth, captureHeight,
                plane.getRowStride(), plane.getPixelStride());
        boolean gridComplete = true;
        for (int gy = 0; gy < VISUAL_HEIGHT; gy++) {
            for (int gx = 0; gx < VISUAL_WIDTH; gx++) {
                int x = PixelWatch.gridSampleX(gx, captureWidth);
                int y = PixelWatch.gridSampleY(gy, captureHeight);
                int cell = watchFrame.rgb(x, y);
                if (cell == PixelWatch.UNKNOWN) gridComplete = false;
                frameTraceGrid[gy * VISUAL_WIDTH + gx] = cell;
            }
        }
        int logicalX = PixelWatch.gridSampleX(VISUAL_X, captureWidth);
        int logicalY = PixelWatch.gridSampleY(VISUAL_Y, captureHeight);
        int rgb = watchFrame.rgb(logicalX, logicalY);
        int red = rgb == PixelWatch.UNKNOWN ? PixelWatch.UNKNOWN : (rgb >> 16) & 0xff;
        int green = rgb == PixelWatch.UNKNOWN ? PixelWatch.UNKNOWN : (rgb >> 8) & 0xff;
        int blue = rgb == PixelWatch.UNKNOWN ? PixelWatch.UNKNOWN : rgb & 0xff;
        int luma = rgb == PixelWatch.UNKNOWN
                ? PixelWatch.UNKNOWN : (77 * red + 150 * green + 29 * blue) >> 8;
        // CAM05 is a diagnostic-only full ROI. Sampling its 520x320 native
        // area here made the supposedly lossless trace callback scan roughly
        // 166,000 pixels per frame. Leave that diagnostic absent in trace
        // mode; the state authority is the paired fixed bottom strokes.
        int cam05MeanLuma = PixelWatch.UNKNOWN;
        int maskLuma = gridComplete ? blockLuma(watchFrame,
                PixelWatch.MASK_BUTTON_X, PixelWatch.MASK_BUTTON_Y,
                PixelWatch.MASK_BUTTON_X + PixelWatch.MASK_BUTTON_WIDTH,
                PixelWatch.MASK_BUTTON_Y + PixelWatch.MASK_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP) : PixelWatch.UNKNOWN;
        int monitorLuma = gridComplete ? blockLuma(watchFrame,
                PixelWatch.MONITOR_BUTTON_X, PixelWatch.MONITOR_BUTTON_Y,
                PixelWatch.MONITOR_BUTTON_X + PixelWatch.MONITOR_BUTTON_WIDTH,
                PixelWatch.MONITOR_BUTTON_Y + PixelWatch.MONITOR_BUTTON_HEIGHT,
                PixelWatch.CONTROL_BUTTON_STEP) : PixelWatch.UNKNOWN;
        int maskDownstroke = gridComplete
                ? PixelWatch.controlDownStrokeScoreFast(watchFrame, true)
                : PixelWatch.UNKNOWN;
        int monitorDownstroke = gridComplete
                ? PixelWatch.controlDownStrokeScoreFast(watchFrame, false)
                : PixelWatch.UNKNOWN;
        int gridMeanLuma = gridComplete
                ? ScreenStats.meanLuma(frameTraceGrid, frameTraceGrid.length)
                : PixelWatch.UNKNOWN;
        long sequence = ++visualSequence;

        // Trace mode deliberately skips the full detector/watchlist pass so it
        // can drain every ImageReader frame. Before this fix that also skipped
        // the normal snapshot publication, leaving FRAME pinned to the image
        // immediately before TRACE start while the trace itself advanced. A
        // lightweight publication keeps FRAME atomic with the current trace
        // image: the same grid, timestamp, sequence, identity, and scalar
        // sample are exposed to a state gate without reintroducing the lossy
        // detector stack that trace mode was designed to avoid.
        int screenIdentity = gridComplete
                ? ScreenIdentity.classify(frameTraceGrid) : ScreenIdentity.UNKNOWN;
        int screenScore = gridComplete ? ScreenIdentity.score(frameTraceGrid) : 0;
        synchronized (snapshotLock) {
            // Trace mode skips the expensive full watchlist, but the live
            // actuator still needs the twelve fixed camera pixels for its arm
            // proof. Retain those cheap native reads (and the paired control
            // means) without reintroducing the CAM05/Foxy ROI scans that made
            // the original lossless path miss frames.
            for (int index = 0; index < watchSpec.size(); index++) {
                PixelWatch.Entry entry = watchSpec.entry(index);
                if (entry.name.startsWith("cam") && entry.kind == PixelWatch.Kind.PIXEL) {
                    snapshotWatchValues[index] = PixelWatch.read(entry, watchFrame);
                } else if (PixelWatch.isCanonicalMaskButton(entry)) {
                    snapshotWatchValues[index] = maskLuma;
                } else if (PixelWatch.isCanonicalMonitorButton(entry)) {
                    snapshotWatchValues[index] = monitorLuma;
                } else {
                    snapshotWatchValues[index] = PixelWatch.UNKNOWN;
                }
            }
            snapshotVisualSequence = sequence;
            snapshotVisualTimestampNs = timestampNs;
            snapshotRed = red;
            snapshotGreen = green;
            snapshotBlue = blue;
            snapshotLuma = luma;
            snapshotCam05MeanLuma = cam05MeanLuma;
            snapshotGridValid = gridComplete;
            System.arraycopy(frameTraceGrid, 0, snapshotGrid, 0, frameTraceGrid.length);
            snapshotGreyCells = gridComplete
                    ? ScreenStats.greyCells(snapshotGrid, snapshotGrid.length)
                    : PixelWatch.UNKNOWN;
            snapshotGridMeanLuma = gridMeanLuma;
            snapshotScreenIdentity = screenIdentity;
            // Traced frames never reach the full snapshot path above, so the
            // onset latch must be fed here too: night5-anchor4 started its
            // trace before the onset and the latch read -1 for 36 reads. This
            // identity is the trace's own column, the same one the post-hoc
            // rule reads.
            nightOnsetLatch.onFrame(timestampNs, screenIdentity);
            snapshotScreenScore = screenScore;
            snapshotMaskButtonMeanLuma = maskLuma;
            snapshotMonitorButtonMeanLuma = monitorLuma;
            snapshotMaskButtonDownstroke = maskDownstroke;
            snapshotMonitorButtonDownstroke = monitorDownstroke;
            snapshotDetectorLatencyMs = Math.max(0L,
                    (System.nanoTime() - callbackNs) / 1_000_000L);
            snapshotPanAnchorX = PanAnchor.UNKNOWN;
            snapshotPanAnchorY = PanAnchor.UNKNOWN;
            snapshotPanAnchorArea = PanAnchor.UNKNOWN;
            snapshotPanAnchorMargin = PanAnchor.UNKNOWN;
            snapshotPanAnchorConfidence = 0;
            snapshotPanAnchorReason = "trace-lightweight-publication";
        }
        recordFrameTrace(frameTraceGrid, timestampNs, SystemClock.elapsedRealtimeNanos(),
                callbackNs, sequence, maskLuma, monitorLuma,
                maskDownstroke, monitorDownstroke,
                screenIdentity, gridMeanLuma);
        // Trace mode reads only the grid and the fixed controls, all clear of
        // the teach panel, so a traced night can still narrate.
        if (overlayController != null && overlayController.teachRunning()) {
            overlayController.onTeachFrame(screenIdentity,
                    PixelWatch.controlState(maskDownstroke, monitorDownstroke));
        }
    }

    /**
     * Convert the current immutable capture facts into the HUD leaf contract.
     * No action vocabulary is inferred here: decision mode receives an empty
     * cue until a qualified belief/arbiter producer supplies one.
     */
    private void publishOverlaySnapshot(long renderedNs, String invalidReason) {
        OverlaySnapshot.Mode mode = overlayController.mode();
        if (mode != OverlaySnapshot.Mode.SENSOR_DEBUG) return;
        OverlaySnapshot.Screen screen;
        OverlaySnapshot.Region[] regions;
        long sequence;
        long detectorLatencyMs;
        OverlaySnapshot.MonitorState monitorState;
        String monitorReason;
        String selectedCamera;
        String cameraReason;
        BatteryLifeDetector.Result battery;
        synchronized (snapshotLock) {
            sequence = ++overlaySequence;
            detectorLatencyMs = snapshotDetectorLatencyMs;
            screen = invalidReason == null
                    ? OverlaySnapshot.Screen.fromIdentity(snapshotScreenIdentity)
                    : OverlaySnapshot.Screen.UNKNOWN;
            MonitorStateDetector.Result monitor = invalidReason == null
                    ? MonitorStateDetector.fromNativeControlStrokes(
                            snapshotScreenIdentity,
                            snapshotMaskButtonDownstroke,
                            snapshotMonitorButtonDownstroke)
                    : MonitorStateDetector.fromNativeControlStrokes(
                            ScreenIdentity.UNKNOWN,
                            snapshotMaskButtonDownstroke,
                            snapshotMonitorButtonDownstroke);
            CameraSelectionDetector.Result camera = CameraSelectionDetector.measure(
                    watchSpec, snapshotWatchValues, monitor);
            switch (monitor.state) {
                case UP:
                    monitorState = OverlaySnapshot.MonitorState.UP;
                    break;
                case DOWN:
                    monitorState = OverlaySnapshot.MonitorState.DOWN;
                    break;
                case UNKNOWN:
                default:
                    monitorState = OverlaySnapshot.MonitorState.UNKNOWN;
                    break;
            }
            monitorReason = monitor.reason;
            selectedCamera = camera.observed() ? camera.selectedCamera : null;
            cameraReason = camera.reason;
            battery = BatteryLifeDetector.measureForScreen(watchSpec,
                    snapshotWatchValues, snapshotScreenIdentity,
                    PixelWatch.controlState(snapshotMaskButtonDownstroke,
                            snapshotMonitorButtonDownstroke));
            regions = new OverlaySnapshot.Region[overlayController.contract().size()];
            long ageMs = Math.max(0L,
                    snapshotVisualTimestampNs > 0L
                            ? (renderedNs - snapshotVisualTimestampNs) / 1_000_000L : 0L);
            OverlaySnapshot.FactState state = invalidReason == null
                    ? OverlaySnapshot.FactState.MONITORED
                    : "frame-stale".equals(invalidReason)
                            ? OverlaySnapshot.FactState.STALE
                            : OverlaySnapshot.FactState.UNKNOWN;
            for (int index = 0; index < regions.length; index++) {
                RoiSpec roi = overlayController.contract().region(index);
                int value = invalidReason == null
                        ? snapshotWatchValues[index] : PixelWatch.UNKNOWN;
                OverlaySnapshot.FactState regionState = value == PixelWatch.UNKNOWN
                        ? OverlaySnapshot.FactState.UNKNOWN : state;
                regions[index] = new OverlaySnapshot.Region(
                        roi.id, regionState, value, Double.NaN,
                        OverlaySnapshot.ScoreType.NONE, ageMs,
                        detectorLatencyMs, false);
            }
        }
        overlayController.publishSensorSnapshot(new OverlaySnapshot(
                sequence, renderedNs, screen, mode, regions,
                OverlaySnapshot.Cue.none(), monitorState, monitorReason,
                selectedCamera, cameraReason, battery.observed() ? battery.percent : -1,
                battery.reason));
    }

    /** The whole 20x9 sensor as hex, for classifying what a single pixel cannot. */
    private String currentGrid() {
        StringBuilder out = new StringBuilder(16 + snapshotGrid.length * 6);
        synchronized (snapshotLock) {
            if (!snapshotGridValid) {
                return "ERROR grid-unavailable";
            }
            out.append("OK grid=").append(VISUAL_WIDTH).append('x').append(VISUAL_HEIGHT)
                    .append(" seq=").append(snapshotVisualSequence).append(' ');
            for (int cell : snapshotGrid) {
                out.append(HEX[(cell >> 20) & 0xf]).append(HEX[(cell >> 16) & 0xf])
                        .append(HEX[(cell >> 12) & 0xf]).append(HEX[(cell >> 8) & 0xf])
                        .append(HEX[(cell >> 4) & 0xf]).append(HEX[cell & 0xf]);
            }
        }
        return out.toString();
    }

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** Mean luma over a rectangle with a bounded sampling step. */
    private static int blockLuma(PixelWatch.Frame frame,
            int x0, int y0, int x1, int y1, int step) {
        return PixelWatch.blockLuma(frame, x0, y0, x1, y1, step);
    }

    private static boolean validCaptureSize(int width, int height) {
        if (width < PixelWatch.GRID_WIDTH || height < PixelWatch.GRID_HEIGHT
                || width > PixelWatch.NATIVE_WIDTH || height > PixelWatch.NATIVE_HEIGHT) {
            return false;
        }
        return (long) width * PixelWatch.GRID_HEIGHT
                == (long) height * PixelWatch.GRID_WIDTH;
    }

    private String capturedContentInvalidReason() {
        if (Build.VERSION.SDK_INT < 34) {
            return "content-invariants-unavailable";
        }
        if (capturedContentVisibility != 1) {
            return capturedContentVisibility == 0 ? "content-hidden" : "visibility-pending";
        }
        int width = capturedContentWidth;
        int height = capturedContentHeight;
        if (width <= 0 || height <= 0) {
            return "size-pending";
        }
        // The fixed 20x9 sensor maps to the calibrated 2400x1080 landscape
        // display. Permit 2% aspect drift for compositor rounding, but reject
        // portrait, split-screen, or another capture region before sampling is
        // ever allowed to influence a controller.
        long scaledWidth = (long) width * VISUAL_HEIGHT;
        long scaledHeight = (long) height * VISUAL_WIDTH;
        long error = Math.abs(scaledWidth - scaledHeight);
        if (error * 50L > Math.max(scaledWidth, scaledHeight)) {
            return "aspect-mismatch";
        }
        return null;
    }

    private String watchStatus() {
        return "watch=" + (watchActive ? "ACTIVE" : "OFF")
                + " spec=" + watchSpec.sha256()
                + " entries=" + watchSpec.size();
    }

    /** Return one bounded, authenticated-read response for the active watch. */
    private String currentWatch() {
        if (!watchActive) {
            return "ERROR watch-not-loaded expected=" + watchSpec.sha256();
        }

        long sequence;
        long timestampNs;
        int panAnchorX;
        int panAnchorY;
        int panAnchorArea;
        int panAnchorMargin;
        int panAnchorConfidence;
        String panAnchorReason;
        int[] values = new int[watchSpec.size()];
        synchronized (snapshotLock) {
            sequence = snapshotVisualSequence;
            timestampNs = snapshotVisualTimestampNs;
            panAnchorX = snapshotPanAnchorX;
            panAnchorY = snapshotPanAnchorY;
            panAnchorArea = snapshotPanAnchorArea;
            panAnchorMargin = snapshotPanAnchorMargin;
            panAnchorConfidence = snapshotPanAnchorConfidence;
            panAnchorReason = snapshotPanAnchorReason;
            System.arraycopy(snapshotWatchValues, 0, values, 0, values.length);
        }
        long nowNs = System.nanoTime();
        long ageUs = timestampNs > 0 ? (nowNs - timestampNs) / 1_000L : -1;
        String invalidReason = ageUs < 0
                ? "frame-pending"
                : ageUs > MAX_VISUAL_FRAME_AGE_US
                        ? "frame-stale" : capturedContentInvalidReason();
        StringBuilder result = new StringBuilder(256);
        result.append("OK read=")
                .append(invalidReason == null ? "OBSERVED" : "UNKNOWN")
                .append(" spec=").append(watchSpec.sha256())
                .append(" seq=").append(sequence)
                .append(" snapshotNs=").append(timestampNs)
                .append(" ageUs=").append(ageUs);
        if (invalidReason != null) result.append(" reason=").append(invalidReason);
        for (int i = 0; i < watchSpec.size(); i++) {
            result.append(' ').append(watchSpec.entry(i).name).append('=');
            result.append(invalidReason != null || values[i] == PixelWatch.UNKNOWN
                    ? "UNKNOWN" : values[i]);
        }
        appendPanAnchor(result, invalidReason, panAnchorX, panAnchorY, panAnchorArea,
                panAnchorMargin, panAnchorConfidence, panAnchorReason);
        return result.toString();
    }

    private static void appendPanAnchor(StringBuilder result, String invalidReason,
            int x, int y, int area, int margin, int confidence, String reason) {
        boolean observed = invalidReason == null && x != PanAnchor.UNKNOWN;
        result.append(" pan_anchor_state=").append(observed ? "OBSERVED" : "UNKNOWN")
                .append(" pan_anchor_x=").append(observed ? Integer.toString(x) : "UNKNOWN")
                .append(" pan_anchor_y=").append(observed ? Integer.toString(y) : "UNKNOWN")
                .append(" pan_anchor_area=").append(observed ? Integer.toString(area) : "UNKNOWN")
                .append(" pan_anchor_margin=").append(observed ? Integer.toString(margin) : "UNKNOWN")
                .append(" pan_anchor_confidence=").append(observed
                        ? Integer.toString(confidence) : "UNKNOWN")
                .append(" pan_anchor_reason=")
                .append(invalidReason != null ? invalidReason
                        : reason == null ? "not-measured" : reason);
    }

    private void startControlServer(long generation) throws IOException {
        byte[] tokenBytes = new byte[16];
        new SecureRandom().nextBytes(tokenBytes);
        char[] tokenChars = new char[tokenBytes.length * 2];
        final char[] hex = "0123456789abcdef".toCharArray();
        for (int i = 0; i < tokenBytes.length; i++) {
            int value = tokenBytes[i] & 0xff;
            tokenChars[i * 2] = hex[value >>> 4];
            tokenChars[i * 2 + 1] = hex[value & 0xf];
        }
        controlToken = new String(tokenChars);

        ServerSocket server = new ServerSocket();
        server.setReuseAddress(true);
        // Bind the IPv4 loopback explicitly. getLoopbackAddress() resolved to
        // ::1 on the API-36 target, and the device shell's nc reaches the
        // documented 127.0.0.1:49707 contract over IPv4 only.
        server.bind(new InetSocketAddress(
                InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), CONTROL_PORT), 1);
        controlServer = server;
        tcpControlUp = true;

        // The abstract socket is the cable-bound channel: `adb forward` reaches
        // it without the app opening a port any other process can probe. The
        // loopback port stays for the on-device controller, whose whole point
        // is deciding without an adb round trip.
        controlSocketName = CONTROL_SOCKET_PREFIX + "."
                + Long.toUnsignedString(generation, 36);
        LocalServerSocket localServer = openLocalControlServer(controlSocketName);
        localControlServer = localServer;
        localControlUp = true;

        controlRunning = true;
        publishControlStatus();
        Log.i(TAG, lastControl);

        controlThread = new Thread(
                () -> controlLoop(generation, server), "cue-control");
        controlThread.start();
        localControlThread = new Thread(
                () -> localControlLoop(generation, localServer), "cue-control-local");
        localControlThread.start();
    }

    private LocalServerSocket openLocalControlServer(String socketName) throws IOException {
        IOException lastError = null;
        for (int attempt = 0; attempt < 10; attempt++) {
            try {
                return new LocalServerSocket(socketName);
            } catch (IOException error) {
                lastError = error;
                if (attempt < 9) {
                    SystemClock.sleep(50L);
                }
            }
        }
        throw lastError;
    }

    private void publishControlStatus() {
        String state = tcpControlUp && localControlUp
                ? "READY"
                : tcpControlUp || localControlUp ? "DEGRADED" : "UNAVAILABLE";
        lastControl = "control=" + state
                + " port=" + (tcpControlUp ? String.valueOf(CONTROL_PORT) : "none")
                + " socket=" + (localControlUp ? controlSocketName : "none")
                + " token=" + (controlToken == null ? "none" : controlToken)
                + " " + watchStatus();
    }

    private void controlLoop(long generation, ServerSocket server) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        while (controlRunning && sessionActive(generation)) {
            try {
                Socket accepted = server.accept();
                try (Socket client = accepted) {
                    client.setSoTimeout(CONTROL_READ_TIMEOUT_MS);
                    serveControlRequest(client.getInputStream(), client.getOutputStream());
                } catch (IOException error) {
                    if (controlRunning && sessionActive(generation)) {
                        // A slow, disconnected, or malformed client loses only
                        // its own request. It cannot tear down the listener.
                        Log.w(TAG, "control client failed", error);
                    }
                }
            } catch (SocketException error) {
                // One dead listener must not silence the other channel, so the
                // shared shutdown flag is left alone here.
                if (controlRunning && sessionActive(generation)) {
                    Log.e(TAG, "control socket failed", error);
                    tcpControlUp = false;
                    publishControlStatus();
                    publishCombinedStatus("RUNNING");
                }
                break;
            } catch (Throwable error) {
                if (controlRunning && sessionActive(generation)) {
                    Log.w(TAG, "control request failed", error);
                }
            }
        }
    }

    private void localControlLoop(long generation, LocalServerSocket server) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        while (controlRunning && sessionActive(generation)) {
            try {
                LocalSocket accepted = server.accept();
                try (LocalSocket client = accepted) {
                    client.setSoTimeout(CONTROL_READ_TIMEOUT_MS);
                    serveControlRequest(client.getInputStream(), client.getOutputStream());
                } catch (IOException error) {
                    if (controlRunning && sessionActive(generation)) {
                        Log.w(TAG, "local control client failed", error);
                    }
                }
            } catch (IOException error) {
                if (controlRunning && sessionActive(generation)) {
                    Log.e(TAG, "local control socket failed", error);
                    localControlUp = false;
                    publishControlStatus();
                    publishCombinedStatus("RUNNING");
                }
                break;
            } catch (Throwable error) {
                if (controlRunning && sessionActive(generation)) {
                    Log.w(TAG, "local control request failed", error);
                }
            }
        }
    }

    private void serveControlRequest(InputStream input, OutputStream output)
            throws IOException {
        String request = readBoundedControlLine(input);
        String response;
        if (request == null) {
            response = "ERROR request-too-long";
        } else {
            String[] field = request.split(" ");
            String token = controlToken;
            if (field.length < 2 || token == null || !token.equals(field[1])) {
                response = "ERROR unauthorized";
            } else {
                response = dispatchControl(field);
            }
        }
        output.write((response + "\n").getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }

    private static boolean validFrameTraceLabel(String label) {
        if (label == null || label.length() < 1 || label.length() > 48) {
            return false;
        }
        for (int index = 0; index < label.length(); index++) {
            char value = label.charAt(index);
            if (!((value >= 'a' && value <= 'z')
                    || (value >= 'A' && value <= 'Z')
                    || (value >= '0' && value <= '9')
                    || value == '-' || value == '_' || value == '.')) {
                return false;
            }
        }
        return true;
    }

    private String startFrameTrace(String label) {
        if (captureWidth != PixelWatch.NATIVE_WIDTH
                || captureHeight != PixelWatch.NATIVE_HEIGHT) {
            return "ERROR trace-native-resolution-required capture="
                    + captureWidth + "x" + captureHeight;
        }
        if (!validFrameTraceLabel(label)) {
            return "ERROR trace-label";
        }
        synchronized (frameTraceLock) {
            if (frameTraceActive || frameTrace != null) {
                return "ERROR trace-already-active";
            }
            File directory = new File(getFilesDir(), "frame-traces");
            if (!directory.isDirectory() && !directory.mkdirs()) {
                return "ERROR trace-directory";
            }
            long startNs = System.nanoTime();
            long startElapsedNs = SystemClock.elapsedRealtimeNanos();
            File file = new File(directory, label + "-" + startNs + ".tsv");
            frameTrace = new FrameTrace(label, file, startNs, startElapsedNs);
            frameTraceActive = true;
            // The trace always carries the native control ROIs, independent
            // of whether a live consumer previously loaded the watchlist.
            synchronized (snapshotLock) {
                watchActive = true;
            }
            lastFrameTrace = frameTrace.status("ACTIVE");
            return "OK " + lastFrameTrace;
        }
    }

    private String stopFrameTrace() {
        FrameTrace trace;
        synchronized (frameTraceLock) {
            trace = frameTrace;
            if (trace == null) {
                return "ERROR trace-not-active";
            }
            frameTraceActive = false;
            frameTrace = null;
        }
        try {
            trace.write();
            lastFrameTrace = trace.status(trace.full ? "FULL" : "STOPPED");
            return "OK " + lastFrameTrace;
        } catch (IOException error) {
            lastFrameTrace = trace.status("WRITE-ERROR");
            Log.e(TAG, "frame trace write failed", error);
            return "ERROR trace-write " + error.getClass().getSimpleName();
        }
    }

    private String frameTraceStatus() {
        synchronized (frameTraceLock) {
            if (frameTrace == null) return lastFrameTrace;
            return frameTrace.status(frameTraceActive ? "ACTIVE" : "READY");
        }
    }

    private void recordFrameTrace(int[] sourceGrid, long timestampNs, long elapsedNs,
            long callbackNs, long sequence, int maskLuma, int monitorLuma,
            int maskDownstroke, int monitorDownstroke,
            int screenIdentity, int gridMeanLuma) {
        synchronized (frameTraceLock) {
            if (!frameTraceActive || frameTrace == null) return;
            boolean retained = frameTrace.record(timestampNs, elapsedNs, callbackNs, sequence,
                    sourceGrid, maskLuma, monitorLuma, maskDownstroke, monitorDownstroke,
                    screenIdentity, gridMeanLuma);
            if (!retained) {
                frameTraceActive = false;
                lastFrameTrace = frameTrace.status("FULL");
            }
        }
    }

    /** Capture thread: the whole native frame as ARGB, for one SNAP. */
    private void copySnap(ByteBuffer buffer, int rowStride, int pixelStride, long imageNs) {
        int width = captureWidth;
        int height = captureHeight;
        int[] out = new int[width * height];
        byte[] row = new byte[rowStride];
        ByteBuffer view = buffer.duplicate();
        for (int y = 0; y < height; y++) {
            view.position(y * rowStride);
            view.get(row, 0, Math.min(rowStride, view.remaining()));
            for (int x = 0; x < width; x++) {
                int at = x * pixelStride;
                out[y * width + x] = 0xff000000 | ((row[at] & 0xff) << 16)
                        | ((row[at + 1] & 0xff) << 8) | (row[at + 2] & 0xff);
            }
        }
        snapPixels = out;
        snapImageNs = imageNs;
    }

    /**
     * {@code SNAP <token> <label>}: write the next native frame to
     * {@code files/frames/<label>.png}. For screens where latency does not
     * matter (title, menus, calibration); a night reads REGION instead.
     */
    private String snapControl(String[] field) {
        if (field.length != 3 || !validFrameTraceLabel(field[2])) return "ERROR snap-usage";
        if (captureWidth != PixelWatch.NATIVE_WIDTH || captureHeight != PixelWatch.NATIVE_HEIGHT) {
            return "ERROR snap-native-resolution-required";
        }
        CountDownLatch latch = new CountDownLatch(1);
        snapRequest = latch;
        try {
            if (!latch.await(2000, TimeUnit.MILLISECONDS)) return "ERROR snap-no-frame";
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return "ERROR snap-interrupted";
        } finally {
            snapRequest = null;
        }
        int[] pixels = snapPixels;
        long imageNs = snapImageNs;
        snapPixels = null;
        File directory = new File(getFilesDir(), "frames");
        if (!directory.isDirectory() && !directory.mkdirs()) return "ERROR snap-directory";
        File file = new File(directory, field[2] + ".png");
        Bitmap bitmap = Bitmap.createBitmap(pixels, captureWidth, captureHeight,
                Bitmap.Config.ARGB_8888);
        try (FileOutputStream stream = new FileOutputStream(file)) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) return "ERROR snap-encode";
        } catch (IOException error) {
            return "ERROR snap-write";
        } finally {
            bitmap.recycle();
        }
        return "OK path=files/frames/" + file.getName() + " imageNs=" + imageNs
                + " snapshotNs=" + System.nanoTime();
    }

    /**
     * {@code REGION <token> set <name> <x> <y> <w> <h> <step>},
     * {@code REGION <token> clear}, {@code REGION <token> read}. A read carries
     * the helper's clock at reply time as {@code snapshotNs}, beside the
     * copied frame's {@code imageNs}, so a host can place both on its own clock.
     */
    private String regionControl(String[] field) {
        if (field.length < 3) return "ERROR region-usage";
        if (captureWidth != PixelWatch.NATIVE_WIDTH || captureHeight != PixelWatch.NATIVE_HEIGHT) {
            return "ERROR region-native-resolution-required capture="
                    + captureWidth + "x" + captureHeight;
        }
        switch (field[2]) {
            case "set": {
                if (field.length != 9) return "ERROR region-set-usage";
                int[] v = new int[5];
                try {
                    for (int i = 0; i < 5; i++) v[i] = Integer.parseInt(field[4 + i]);
                } catch (NumberFormatException error) {
                    return "ERROR region-number";
                }
                String refused = nativeRegions.set(field[3], v[0], v[1], v[2], v[3], v[4]);
                return refused == null ? "OK regions=" + nativeRegions.size() : "ERROR " + refused;
            }
            case "clear":
                nativeRegions.clear();
                return "OK regions=0";
            case "read":
                return "OK " + nativeRegions.read() + " snapshotNs=" + System.nanoTime();
            default:
                return "ERROR region-usage";
        }
    }

    private String dispatchControl(String[] field) {
        switch (field[0]) {
            case "GET":
                return "OK " + currentSnapshot();
            case "FRAME":
                // Snapshot fields AND the sensor from one locked read. GET+GRID
                // can never agree on a sequence, so a live detector must use
                // this verb instead of correlating two round trips.
                return "OK " + currentSnapshot(true);
            case "GRID":
                // The full sensor, 0xRRGGBB per cell, row-major, as hex. One
                // line, no allocation on the capture thread -- the string is
                // built here, on the control thread, only when asked for.
                return currentGrid();
            case "WATCH":
                if (field.length != 3) {
                    return "ERROR watch-usage";
                }
                if ("status".equals(field[2])) {
                    return "OK " + watchStatus();
                }
                if (!watchSpec.sha256().equals(field[2])) {
                    return "ERROR watch-spec-mismatch expected=" + watchSpec.sha256();
                }
                if (captureWidth != PixelWatch.NATIVE_WIDTH
                        || captureHeight != PixelWatch.NATIVE_HEIGHT) {
                    return "ERROR watch-native-resolution-required capture="
                            + captureWidth + "x" + captureHeight;
                }
                synchronized (snapshotLock) {
                    watchActive = true;
                }
                publishControlStatus();
                return "OK " + watchStatus();
            case "READ":
                if (field.length != 2) {
                    return "ERROR read-usage";
                }
                return currentWatch();
            case "REGION":
                return regionControl(field);
            case "SNAP":
                return snapControl(field);
            case "TRACE":
                if (field.length < 3) {
                    return "ERROR trace-usage";
                }
                switch (field[2]) {
                    case "start":
                        return field.length == 4
                                ? startFrameTrace(field[3]) : "ERROR trace-start-usage";
                    case "stop":
                        return field.length == 3
                                ? stopFrameTrace() : "ERROR trace-stop-usage";
                    case "status":
                        return field.length == 3
                                ? "OK " + frameTraceStatus() : "ERROR trace-status-usage";
                    default:
                        return "ERROR trace-usage";
                }
            case "OVERLAY":
                if (field.length != 2) {
                    return "ERROR overlay-usage";
                }
                return "OK " + (overlayController == null
                        ? "overlay=UNAVAILABLE" : overlayController.status());
            case "LESSON":
                return dispatchLesson(field);
            default:
                return "ERROR unknown-verb";
        }
    }

    /**
     * The teach panel's lesson channel. A host uploads the schedule it is about
     * to run (begin, rows, commit), then names its origin against this
     * service's own latched onset. It writes nothing but the panel's lesson:
     * no detector, watch, latch, or capture state is touched here.
     */
    private String dispatchLesson(String[] field) {
        if (overlayController == null) return "ERROR overlay-unavailable";
        if (field.length < 3) return "ERROR lesson-usage";
        try {
            switch (field[2]) {
                case "begin":
                    synchronized (lessonLock) {
                        pendingLesson = null;
                        pendingLesson = CycleLesson.Builder.begin(field, 3);
                    }
                    return "OK lesson=BEGUN";
                case "row":
                    synchronized (lessonLock) {
                        if (pendingLesson == null) return "ERROR lesson-not-begun";
                        pendingLesson.row(field, 3);
                    }
                    return "OK lesson=ROW";
                case "commit": {
                    if (field.length != 3) return "ERROR lesson-usage";
                    CycleLesson lesson;
                    synchronized (lessonLock) {
                        CycleLesson.Builder builder = pendingLesson;
                        pendingLesson = null;
                        if (builder == null) return "ERROR lesson-not-begun";
                        lesson = builder.build();
                    }
                    return overlayController.armTeach(lesson);
                }
                case "origin": {
                    if (field.length != 5 || !field[3].matches("[0-9]{1,19}")
                            || !field[4].matches("[0-9]{1,10}")) {
                        return "ERROR lesson-origin-usage";
                    }
                    long hostOnsetNs = Long.parseLong(field[3]);
                    long afterOnsetUs = Long.parseLong(field[4]);
                    long latchNs = nightOnsetLatch.onsetNs();
                    if (latchNs == NightOnsetLatch.NOT_LATCHED) {
                        return "ERROR lesson-onset-not-latched";
                    }
                    // The host's onset is this latch read back through ms;
                    // anything further off is a different night.
                    if (Math.abs(latchNs - hostOnsetNs) > 1_000_000L) {
                        return "ERROR lesson-onset-mismatch latchNs=" + latchNs;
                    }
                    if (afterOnsetUs > 60_000_000L) return "ERROR lesson-origin-range";
                    return overlayController.startTeach(latchNs, afterOnsetUs);
                }
                case "clear":
                    if (field.length != 3) return "ERROR lesson-usage";
                    synchronized (lessonLock) {
                        pendingLesson = null;
                    }
                    return overlayController.clearTeach();
                case "status":
                    if (field.length != 3) return "ERROR lesson-usage";
                    return overlayController.teachStatus();
                case "f1":
                    return overlayController.f1Command(field, 3);
                case "f3":
                    return overlayController.f3Command(field, 3);
                case "f4":
                    return overlayController.f4Command(field, 3);
                default:
                    return "ERROR lesson-usage";
            }
        } catch (IllegalArgumentException refused) {
            // A refused row or commit discards the whole upload.
            synchronized (lessonLock) {
                pendingLesson = null;
            }
            return "ERROR " + refused.getMessage();
        }
    }

    private String readBoundedControlLine(InputStream input) throws IOException {
        byte[] bytes = new byte[CONTROL_LINE_LIMIT];
        int length = 0;
        while (length < bytes.length) {
            int value = input.read();
            if (value == -1 || value == '\n') {
                return new String(bytes, 0, length, StandardCharsets.US_ASCII);
            }
            if (value == '\r') {
                continue;
            }
            if (value < 0x20 || value > 0x7e) {
                return "";
            }
            bytes[length++] = (byte) value;
        }
        return null;
    }

    private String currentSnapshot() {
        return currentSnapshot(false);
    }

    /**
     * One observation. With {@code withGrid} the 180-cell sensor is serialized
     * from the SAME locked read as the snapshot fields, so both describe one
     * frame and carry one sequence number.
     *
     * <p>Without it a host must call GET then GRID, two round trips against a
     * 60 fps capture: measured on 2026-09-05 the two sequences agreed 0 times
     * in 12, always 1-2 frames apart, so every consumer needing freshness AND
     * cells refused with grid-seq-mismatch and no positive state was ever
     * reachable. Atomicity here is the fix; the caller stops correlating.</p>
     */
    private String currentSnapshot(boolean withGrid) {
        int[] gridCopy = null;
        String screenDetail;
        long visualSequenceSnapshot;
        long visualTimestampNs;
        int red;
        int green;
        int blue;
        int luma;
        int cam05MeanLuma;
        int greyCells;
        int gridMeanLuma;
        int screenIdentity;
        int screenScore;
        int maskButtonMeanLuma;
        int monitorButtonMeanLuma;
        int maskButtonDownstroke;
        int monitorButtonDownstroke;
        long detectorLatencyMs;
        int panAnchorX;
        int panAnchorY;
        int panAnchorArea;
        int panAnchorMargin;
        int panAnchorConfidence;
        String panAnchorReason;
        MonitorStateDetector.Result monitor;
        CameraSelectionDetector.Result camera;
        BatteryLifeDetector.Result battery;
        synchronized (snapshotLock) {
            visualSequenceSnapshot = snapshotVisualSequence;
            visualTimestampNs = snapshotVisualTimestampNs;
            red = snapshotRed;
            green = snapshotGreen;
            blue = snapshotBlue;
            luma = snapshotLuma;
            cam05MeanLuma = snapshotCam05MeanLuma;
            greyCells = snapshotGreyCells;
            gridMeanLuma = snapshotGridMeanLuma;
            screenIdentity = snapshotScreenIdentity;
            screenScore = snapshotScreenScore;
            maskButtonMeanLuma = snapshotMaskButtonMeanLuma;
            monitorButtonMeanLuma = snapshotMonitorButtonMeanLuma;
            maskButtonDownstroke = snapshotMaskButtonDownstroke;
            monitorButtonDownstroke = snapshotMonitorButtonDownstroke;
            detectorLatencyMs = snapshotDetectorLatencyMs;
            panAnchorX = snapshotPanAnchorX;
            panAnchorY = snapshotPanAnchorY;
            panAnchorArea = snapshotPanAnchorArea;
            panAnchorMargin = snapshotPanAnchorMargin;
            panAnchorConfidence = snapshotPanAnchorConfidence;
            panAnchorReason = snapshotPanAnchorReason;
            monitor = MonitorStateDetector.fromNativeControlStrokes(
                    snapshotScreenIdentity, maskButtonDownstroke,
                    monitorButtonDownstroke);
            camera = CameraSelectionDetector.measure(watchSpec, snapshotWatchValues,
                    monitor);
            battery = BatteryLifeDetector.measureForScreen(watchSpec,
                    snapshotWatchValues, snapshotScreenIdentity,
                    PixelWatch.controlState(maskButtonDownstroke,
                            monitorButtonDownstroke));
            gridCopy = withGrid && snapshotGridValid ? snapshotGrid.clone() : null;
            screenDetail = ScreenIdentity.describe(snapshotGridValid ? snapshotGrid : null);
        }

        long nowNs = System.nanoTime();
        // The game seeds its RNG from System.currentTimeMillis() at scene load;
        // read the wall clock beside the monotonic one so the host can place a
        // monotonic image timestamp (nightOnsetImageNs) on the phone's wall clock.
        long nowWallMs = System.currentTimeMillis();
        long visualAgeUs = visualTimestampNs > 0
                ? (nowNs - visualTimestampNs) / 1_000L : -1;
        String invalidReason = visualAgeUs < 0
                ? "timestamp-invalid"
                : visualAgeUs > MAX_VISUAL_FRAME_AGE_US
                        ? "frame-stale"
                        : capturedContentInvalidReason();
        String visual;
        if (invalidReason == null) {
            visual = String.format(Locale.US,
                    "visual=OBSERVED visualReason=none seq=%d rgba=%d,%d,%d luma=%d cam05_mean_luma=%d "
                            + "grey=%d gridLuma=%d ageUs=%d content=%dx%d visible=%d "
                            + "screen=%s screenScore=%d detectorLatencyMs=%d "
                            + "monitorUp=%s monitorReason=%s cameraSelected=%s cameraHighlights=%s "
                            + "cameraReason=%s "
                            + "batteryPercent=%s batteryReason=%s "
                            + "mask_button_mean_luma=%s monitor_button_mean_luma=%s "
                            + "mask_button_downstroke=%s monitor_button_downstroke=%s",
                    visualSequenceSnapshot, red, green, blue, luma, cam05MeanLuma,
                    greyCells, gridMeanLuma, visualAgeUs,
                    capturedContentWidth, capturedContentHeight,
                    capturedContentVisibility, ScreenIdentity.label(screenIdentity),
                    screenScore, detectorLatencyMs, monitorValue(monitor), monitor.reason,
                    camera.selectedCamera == null ? "UNKNOWN" : camera.selectedCamera,
                    cameraHighlightsValue(camera), camera.reason,
                    battery.observed() ? Integer.toString(battery.percent) : "UNKNOWN",
                    battery.reason, nativeLumaValue(maskButtonMeanLuma),
                    nativeLumaValue(monitorButtonMeanLuma),
                    nativeStrokeValue(maskButtonDownstroke),
                    nativeStrokeValue(monitorButtonDownstroke));
        } else {
            visual = String.format(Locale.US,
                    "visual=UNKNOWN visualReason=%s seq=%d reason=%s ageUs=%d content=%dx%d visible=%d "
                            + "screen=UNKNOWN screenScore=0 detectorLatencyMs=%d "
                            + "monitorUp=UNKNOWN monitorReason=%s cameraSelected=UNKNOWN "
                            + "cameraHighlights=UNKNOWN "
                    + "cameraReason=%s batteryPercent=UNKNOWN batteryReason=%s "
                    + "mask_button_mean_luma=%s monitor_button_mean_luma=%s "
                    + "mask_button_downstroke=%s monitor_button_downstroke=%s",
                    invalidReason, visualSequenceSnapshot, invalidReason, visualAgeUs,
                    capturedContentWidth, capturedContentHeight,
                    capturedContentVisibility, detectorLatencyMs, monitor.reason,
                    camera.reason, invalidReason, nativeLumaValue(maskButtonMeanLuma),
                    nativeLumaValue(monitorButtonMeanLuma),
                    nativeStrokeValue(maskButtonDownstroke),
                    nativeStrokeValue(monitorButtonDownstroke));
        }

        StringBuilder panAnchor = new StringBuilder(160);
        appendPanAnchor(panAnchor, invalidReason, panAnchorX, panAnchorY,
                panAnchorArea, panAnchorMargin, panAnchorConfidence, panAnchorReason);
        StringBuilder frame = new StringBuilder(64);
        if (gridCopy != null) {
            frame.append(" grid=").append(VISUAL_WIDTH).append('x').append(VISUAL_HEIGHT)
                    .append(" cells=");
            for (int cell : gridCopy) {
                frame.append(HEX[(cell >> 20) & 0xf]).append(HEX[(cell >> 16) & 0xf])
                        .append(HEX[(cell >> 12) & 0xf]).append(HEX[(cell >> 8) & 0xf])
                        .append(HEX[(cell >> 4) & 0xf]).append(HEX[cell & 0xf]);
            }
        }
        return "snapshotNs=" + nowNs + " wallMs=" + nowWallMs + " visualCaptureNs=" + visualTimestampNs
                + " nightOnsetImageNs=" + nightOnsetLatch.onsetNs()
                + " " + visual + panAnchor + " " + screenDetail + " "
                + watchStatus() + frame;
    }

    private static String cameraHighlightsValue(CameraSelectionDetector.Result camera) {
        if (camera == null) return "UNKNOWN";
        String[] highlighted = camera.highlightedCameras();
        if (highlighted == null || highlighted.length == 0) return "UNKNOWN";
        StringBuilder value = new StringBuilder();
        for (int index = 0; index < highlighted.length; index++) {
            if (index > 0) value.append(',');
            value.append(highlighted[index]);
        }
        return value.toString();
    }

    private static String monitorValue(MonitorStateDetector.Result monitor) {
        if (monitor == null) return "UNKNOWN";
        switch (monitor.state) {
            case UP:
                return "true";
            case DOWN:
                return "false";
            case UNKNOWN:
            default:
                return "UNKNOWN";
        }
    }

    private static String nativeLumaValue(int value) {
        return value == PixelWatch.UNKNOWN ? "UNKNOWN" : Integer.toString(value);
    }

    private static String nativeStrokeValue(int value) {
        return value == PixelWatch.UNKNOWN ? "UNKNOWN" : Integer.toString(value);
    }

    private void publishCombinedStatus(String lifecycle) {
        publishStatus(lifecycle + "\n" + lastVisual
                + "\n" + currentBatteryStatus() + "\n" + lastControl + "\n"
                + (overlayController == null ? "overlay=UNAVAILABLE"
                        : overlayController.status()));
    }

    /** Publish the UI-derived flashlight meter. */
    private String currentBatteryStatus() {
        BatteryLifeDetector.Result battery;
        int identity;
        long timestampNs;
        synchronized (snapshotLock) {
            identity = snapshotScreenIdentity;
            timestampNs = snapshotVisualTimestampNs;
            battery = BatteryLifeDetector.measureForScreen(watchSpec,
                    snapshotWatchValues, snapshotScreenIdentity,
                    PixelWatch.controlState(snapshotMaskButtonDownstroke,
                            snapshotMonitorButtonDownstroke));
        }
        long ageUs = timestampNs > 0L
                ? (System.nanoTime() - timestampNs) / 1_000L : -1L;
        if (identity != ScreenIdentity.FNAF2_NIGHT || ageUs < 0L
                || ageUs > MAX_VISUAL_FRAME_AGE_US || !battery.observed()) {
            String reason = identity != ScreenIdentity.FNAF2_NIGHT
                    ? "screen-identity" : !battery.observed()
                            ? battery.reason : "frame-stale";
            return "battery=UNKNOWN reason=" + reason;
        }
        return "battery=OBSERVED percent=" + battery.percent
                + " bars=" + battery.filledBars + "/" + BatteryLifeDetector.BAR_COUNT
                + " reason=" + battery.reason;
    }

    private void publishStatus(String status) {
        Log.i(TAG, status.replace('\n', ' '));
        Intent broadcast = new Intent(ACTION_STATUS)
                .setPackage(getPackageName())
                .putExtra(EXTRA_STATUS, status);
        sendBroadcast(broadcast);
    }

    private void failAndStop(String reason) {
        stopCapture(reason, true);
        stopSelf();
    }

    private void stopCapture(String reason, boolean stopProjection) {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }
        ++sessionGeneration;
        Log.w(TAG, "stopping capture: " + reason);

        if (overlayController != null) {
            overlayController.onCaptureStopped();
        }

        if (frameTrace != null) {
            // Preserve an in-flight diagnostic trace across an app abort or
            // projection teardown. The frame file is still written on the
            // service thread and remains pullable through run-as.
            String traceResult = stopFrameTrace();
            Log.i(TAG, "frame trace during stop: " + traceResult);
        }

        controlRunning = false;
        ServerSocket server = controlServer;
        controlServer = null;
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
                // Closing an already-failed local server is still stopped.
            }
        }
        LocalServerSocket localServer = localControlServer;
        localControlServer = null;
        if (localServer != null) {
            try {
                localServer.close();
            } catch (IOException ignored) {
                // Closing an already-failed local server is still stopped.
            }
        }
        for (Thread worker : new Thread[] {controlThread, localControlThread}) {
            if (worker != null && worker != Thread.currentThread()) {
                worker.interrupt();
            }
        }
        joinWorker(controlThread);
        joinWorker(localControlThread);
        controlThread = null;
        localControlThread = null;
        tcpControlUp = false;
        localControlUp = false;
        controlToken = null;
        controlSocketName = null;

        ImageReader reader = imageReader;
        imageReader = null;
        if (reader != null) {
            reader.setOnImageAvailableListener(null, null);
            reader.close();
        }
        VirtualDisplay display = virtualDisplay;
        virtualDisplay = null;
        if (display != null) {
            display.release();
        }
        HandlerThread handlerThread = visualThread;
        visualThread = null;
        if (handlerThread != null) {
            handlerThread.quitSafely();
            joinWorker(handlerThread);
        }

        MediaProjection activeProjection = projection;
        projection = null;
        if (activeProjection != null) {
            if (projectionCallback != null) {
                activeProjection.unregisterCallback(projectionCallback);
            }
            if (stopProjection) {
                activeProjection.stop();
            }
        }
        projectionCallback = null;
        capturedContentWidth = 0;
        capturedContentHeight = 0;
        capturedContentVisibility = -1;
        synchronized (snapshotLock) {
            snapshotGridValid = false;
            snapshotScreenIdentity = ScreenIdentity.UNKNOWN;
            snapshotScreenScore = 0;
            snapshotMaskButtonMeanLuma = PixelWatch.UNKNOWN;
            snapshotMonitorButtonMeanLuma = PixelWatch.UNKNOWN;
            snapshotMaskButtonDownstroke = PixelWatch.UNKNOWN;
            snapshotMonitorButtonDownstroke = PixelWatch.UNKNOWN;
            snapshotPanAnchorX = PanAnchor.UNKNOWN;
            snapshotPanAnchorY = PanAnchor.UNKNOWN;
            snapshotPanAnchorArea = PanAnchor.UNKNOWN;
            snapshotPanAnchorMargin = PanAnchor.UNKNOWN;
            snapshotPanAnchorConfidence = 0;
            snapshotPanAnchorReason = "capture-stopped";
            watchActive = false;
        }
        lastOverlaySnapshotNs = 0L;

        lastVisual = "visual=UNAVAILABLE(" + reason + ")";
        lastControl = "control=UNAVAILABLE(" + reason + ")";
        publishCombinedStatus("UNAVAILABLE");
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    private boolean sessionActive(long generation) {
        return sessionGeneration == generation && !stopping.get();
    }

    private void joinWorker(Thread worker) {
        if (worker == null || worker == Thread.currentThread()) return;
        try {
            worker.join(1_000L);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void onDestroy() {
        stopCapture("service-destroyed", true);
        if (overlayController != null) {
            overlayController.destroy();
            overlayController = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
