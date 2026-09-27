package com.ppvaz.fnafcompanion;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
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

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The Companion's capture service: one user-approved MediaProjection at the
 * display's native resolution, and the authenticated control socket that
 * serves it.
 *
 * <p>The game-agnostic observation primitives are {@code REGION} (registered
 * rectangles' raw native pixels, every frame; {@link NativeRegions}) and
 * {@code SNAP} (one whole native frame on request). The rule that decides lives
 * on the host, over those pixels. The FNaF 2 night lane's remaining on-device
 * readers are quarantined in {@link Fnaf2Legacy}.</p>
 */
public final class CaptureService extends Service {
    public static final String ACTION_START =
            "com.fnaf2.cuehelper.action.START";
    public static final String ACTION_QUERY_STATUS =
            "com.fnaf2.cuehelper.action.QUERY_STATUS";
    public static final String ACTION_STOP =
            "com.fnaf2.cuehelper.action.STOP";
    public static final String ACTION_STATUS =
            "com.fnaf2.cuehelper.action.STATUS";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_RESULT_DATA = "resultData";
    public static final String EXTRA_CAPTURE_WIDTH = "captureWidth";
    public static final String EXTRA_CAPTURE_HEIGHT = "captureHeight";
    public static final String EXTRA_STATUS = "status";

    private static final String TAG = "FnafCueHelper";
    private static final String NOTIFICATION_CHANNEL = "capture";
    private static final int NOTIFICATION_ID = 7007;

    private static final long VISUAL_REPORT_INTERVAL_NS = 1_000_000_000L;
    private static final int CONTROL_PORT = 49_707;
    private static final String CONTROL_SOCKET_PREFIX =
            "com.fnaf2.cuehelper.control";
    private static final int CONTROL_LINE_LIMIT = 256;
    private static final int CONTROL_READ_TIMEOUT_MS = 1_000;
    // Three native RGBA buffers are enough for acquireLatestImage and keep the
    // projection from reserving roughly 80 MB for eight 2400x1080 buffers.
    // Trace mode still consumes them in timestamp order; the callback must
    // remain below the 16.7 ms display budget to retain every presentation.
    private static final int IMAGE_READER_MAX_IMAGES = 3;

    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
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

    private long lastVisualReportNs;
    private volatile int capturedContentWidth;
    private volatile int capturedContentHeight;
    // Region and legacy readers are native-resolution by contract. A smaller
    // projection can still be requested for a latency probe, but a native
    // reader refuses to run against it rather than scaling a coordinate.
    private int captureWidth = NativeFrame.WIDTH;
    private int captureHeight = NativeFrame.HEIGHT;
    // -1 is unknown, 0 is hidden, 1 is visible. The API-36 target must not
    // turn a letterboxed or hidden capture into a confident pixel reading.
    private volatile int capturedContentVisibility = -1;
    private volatile String lastVisual = "visual=UNAVAILABLE";
    private volatile String lastControl = "control=UNAVAILABLE";
    private OverlayController overlayController;

    private final NativeFrame.ByteBufferView frameView = new NativeFrame.ByteBufferView();
    // Raw native pixels of reader-registered regions, copied every native
    // frame (REGION verb). The observation primitive for detectors.
    private final NativeRegions nativeRegions =
            new NativeRegions(NativeFrame.WIDTH, NativeFrame.HEIGHT);
    private long regionSequence;
    // One whole native frame on request (SNAP verb): the menu and title
    // readers' input, replacing the full-display screencap. Copied on the
    // capture thread, encoded on the control thread.
    private volatile CountDownLatch snapRequest;
    private int[] snapPixels;
    private long snapImageNs;
    // FNaF 2's remaining on-device readers, quarantined.
    private final Fnaf2Legacy legacy = new Fnaf2Legacy(IMAGE_READER_MAX_IMAGES);
    private final Object lessonLock = new Object();
    private CycleLesson.Builder pendingLesson;

    @Override
    public void onCreate() {
        super.onCreate();
        overlayController = new OverlayController(this,
                state -> publishCombinedStatus(projection == null ? "UNAVAILABLE" : "RUNNING"));
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
                        overlayController.onTargetVisibilityChanged(isVisible ? 1 : 0);
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
            captureWidth = intent.getIntExtra(EXTRA_CAPTURE_WIDTH, NativeFrame.WIDTH);
            captureHeight = intent.getIntExtra(EXTRA_CAPTURE_HEIGHT, NativeFrame.HEIGHT);
            if (!validCaptureSize(captureWidth, captureHeight)) {
                throw new IllegalArgumentException("capture size must be a 20:9 "
                        + "landscape size between 20x9 and 2400x1080");
            }
            overlayController.onCaptureStarted(captureWidth, captureHeight);
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
        startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    }

    private boolean nativeCapture() {
        return captureWidth == NativeFrame.WIDTH && captureHeight == NativeFrame.HEIGHT;
    }

    private void startVisualCapture(long generation) {
        legacy.reset();
        visualThread = new HandlerThread("cue-visual", Process.THREAD_PRIORITY_DISPLAY);
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
                "CompanionCapture",
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
        lastVisual = "visual=STARTING(" + captureWidth + "x" + captureHeight + ")";
        Log.i(TAG, lastVisual);
    }

    private void onImageAvailable(ImageReader reader, long generation) {
        if (!sessionActive(generation)) return;
        Image image = null;
        // A frame trace drains the queue in order and keeps each Image
        // timestamp; normal observation asks for the newest frame.
        boolean drainFrames = legacy.traceActive() && nativeCapture();
        try {
            do {
                image = drainFrames ? reader.acquireNextImage() : reader.acquireLatestImage();
                if (image == null) return;
                long imageNs = image.getTimestamp();
                long callbackNs = System.nanoTime();
                Image.Plane[] planes = image.getPlanes();
                if (planes.length == 0) {
                    if (drainFrames) {
                        legacy.onTraceFrame(null, imageNs, callbackNs,
                                SystemClock.elapsedRealtimeNanos());
                    } else {
                        lastVisual = "visual=UNAVAILABLE(no-plane)";
                        return;
                    }
                } else {
                    Image.Plane plane = planes[0];
                    ByteBuffer buffer = plane.getBuffer();
                    frameView.set(buffer, captureWidth, captureHeight,
                            plane.getRowStride(), plane.getPixelStride());
                    if (nativeCapture()) {
                        nativeRegions.capture(frameView, ++regionSequence, imageNs, callbackNs);
                        CountDownLatch snap = snapRequest;
                        if (snap != null && snap.getCount() > 0) {
                            copySnap(buffer, plane.getRowStride(), plane.getPixelStride(), imageNs);
                            snap.countDown();
                        }
                    }
                    if (!sessionActive(generation)) return;
                    if (drainFrames) {
                        legacy.onTraceFrame(frameView, imageNs, callbackNs,
                                SystemClock.elapsedRealtimeNanos());
                    } else {
                        // While the FNaF 2 teach panel may be on screen, the
                        // one reader that cannot avoid its rectangle is
                        // withheld (TeachPanelTest).
                        boolean teachShown = overlayController != null
                                && overlayController.teachMayBeVisible(imageNs);
                        legacy.onFrame(frameView, imageNs, callbackNs,
                                SystemClock.elapsedRealtimeNanos(), teachShown);
                    }
                }
                if (overlayController != null && overlayController.teachRunning()) {
                    overlayController.onTeachFrame(legacy.identity(), legacy.controlState());
                }
                if (callbackNs - lastVisualReportNs >= VISUAL_REPORT_INTERVAL_NS) {
                    lastVisualReportNs = callbackNs;
                    reportVisual(imageNs, callbackNs);
                }
                if (drainFrames) {
                    image.close();
                    image = null;
                }
            } while (drainFrames && legacy.traceActive() && sessionActive(generation));
        } catch (Throwable error) {
            lastVisual = "visual=UNAVAILABLE(" + error.getClass().getSimpleName() + ")";
            Log.e(TAG, "visual frame failed", error);
            publishCombinedStatus("UNAVAILABLE");
        } finally {
            if (image != null) image.close();
        }
    }

    /** The once-a-second visual line of the combined status. */
    private void reportVisual(long imageNs, long callbackNs) {
        long ageUs = imageNs > 0 ? (callbackNs - imageNs) / 1_000L : -1;
        if (ageUs < 0 || ageUs > 10_000_000L) ageUs = -1;
        String content = capturedContentWidth + "x" + capturedContentHeight
                + " visible=" + capturedContentVisibility;
        String invalidReason = ageUs < 0 ? "timestamp-invalid"
                : ageUs > Fnaf2Legacy.MAX_FRAME_AGE_US ? "frame-stale"
                : capturedContentInvalidReason();
        lastVisual = invalidReason == null
                ? "visual=OBSERVED seq=" + legacy.sequence() + " ageUs=" + ageUs
                        + " content=" + content + " screen="
                        + ScreenIdentity.label(legacy.identity())
                : "visual=UNKNOWN seq=" + legacy.sequence() + " reason=" + invalidReason
                        + " ageUs=" + ageUs + " content=" + content + " screen=UNKNOWN";
        publishCombinedStatus("RUNNING");
    }

    private static boolean validCaptureSize(int width, int height) {
        if (width < Fnaf2Legacy.GRID_WIDTH || height < Fnaf2Legacy.GRID_HEIGHT
                || width > NativeFrame.WIDTH || height > NativeFrame.HEIGHT) {
            return false;
        }
        return (long) width * Fnaf2Legacy.GRID_HEIGHT == (long) height * Fnaf2Legacy.GRID_WIDTH;
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
        // The native readers map to the calibrated 2400x1080 landscape
        // display. Permit 2% aspect drift for compositor rounding, but reject
        // portrait, split-screen, or another capture region before sampling is
        // ever allowed to influence a controller.
        long scaledWidth = (long) width * NativeFrame.HEIGHT;
        long scaledHeight = (long) height * NativeFrame.WIDTH;
        long error = Math.abs(scaledWidth - scaledHeight);
        if (error * 50L > Math.max(scaledWidth, scaledHeight)) {
            return "aspect-mismatch";
        }
        return null;
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
        // loopback port stays for on-device readers.
        controlSocketName = CONTROL_SOCKET_PREFIX + "."
                + Long.toUnsignedString(generation, 36);
        LocalServerSocket localServer = openLocalControlServer(controlSocketName);
        localControlServer = localServer;
        localControlUp = true;

        controlRunning = true;
        publishControlStatus();
        Log.i(TAG, lastControl);

        controlThread = new Thread(() -> controlLoop(generation, server), "cue-control");
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
                + " " + legacy.watchStatus();
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

    private String dispatchControl(String[] field) {
        switch (field[0]) {
            case "GET":
                // The game seeds its RNG from System.currentTimeMillis() at
                // scene load; the wall clock beside the monotonic one lets the
                // host place an image timestamp on the phone's wall clock.
                return field.length == 2 ? "OK " + legacy.snapshotLine(false, System.nanoTime(),
                        System.currentTimeMillis(), capturedContentInvalidReason(),
                        capturedContentWidth, capturedContentHeight, capturedContentVisibility)
                        : "ERROR get-usage";
            case "FRAME":
                return field.length == 2 ? "OK " + legacy.snapshotLine(true, System.nanoTime(),
                        System.currentTimeMillis(), capturedContentInvalidReason(),
                        capturedContentWidth, capturedContentHeight, capturedContentVisibility)
                        : "ERROR frame-usage";
            case "WATCH": {
                if (field.length != 3) return "ERROR watch-usage";
                String reply = legacy.watchCommand(field[2], nativeCapture());
                publishControlStatus();
                return reply;
            }
            case "READ":
                return field.length == 2
                        ? legacy.readLine(System.nanoTime(), capturedContentInvalidReason())
                        : "ERROR read-usage";
            case "TRACE":
                return traceControl(field);
            case "REGION":
                return regionControl(field);
            case "SNAP":
                return snapControl(field);
            case "OVERLAY":
                if (field.length != 2) return "ERROR overlay-usage";
                return "OK " + (overlayController == null
                        ? "overlay=UNAVAILABLE" : overlayController.status());
            case "LESSON":
                return dispatchLesson(field);
            default:
                return "ERROR unknown-verb";
        }
    }

    private String traceControl(String[] field) {
        if (field.length < 3) return "ERROR trace-usage";
        switch (field[2]) {
            case "start":
                return field.length == 4 ? legacy.traceStart(field[3],
                        new File(getFilesDir(), "frame-traces"), nativeCapture(),
                        System.nanoTime(), SystemClock.elapsedRealtimeNanos())
                        : "ERROR trace-start-usage";
            case "stop": {
                if (field.length != 3) return "ERROR trace-stop-usage";
                String reply = legacy.traceStop();
                if (reply.startsWith("ERROR trace-write")) Log.e(TAG, "frame trace write failed");
                return reply;
            }
            case "status":
                return field.length == 3 ? "OK " + legacy.traceStatus() : "ERROR trace-status-usage";
            default:
                return "ERROR trace-usage";
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
        if (field.length != 3 || !Fnaf2Legacy.validLabel(field[2])) return "ERROR snap-usage";
        if (!nativeCapture()) return "ERROR snap-native-resolution-required";
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
        if (!nativeCapture()) {
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

    /**
     * The teach panels' lesson channel. A host uploads the schedule it is
     * about to run (begin, rows, commit), then names its origin against this
     * service's own latched onset; FNaF 1, 3 and 4 feed their own lessons. It
     * writes nothing but a panel's lesson: no detector, region, latch or
     * capture state is touched here.
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
                    long latchNs = legacy.onsetNs();
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

    private void publishCombinedStatus(String lifecycle) {
        publishStatus(lifecycle + "\n" + lastVisual + "\n" + lastControl + "\n"
                + (overlayController == null ? "overlay=UNAVAILABLE"
                        : overlayController.status()));
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
        if (legacy.traceStatus().startsWith("trace=ACTIVE")) {
            // Preserve an in-flight diagnostic trace across an app abort or
            // projection teardown. The frame file is still written on the
            // service thread and remains pullable through run-as.
            Log.i(TAG, "frame trace during stop: " + legacy.traceStop());
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
        legacy.reset();
        nativeRegions.clear();

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
