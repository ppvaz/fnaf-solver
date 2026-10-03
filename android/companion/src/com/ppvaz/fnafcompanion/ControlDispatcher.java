package com.ppvaz.fnafcompanion;

import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * The control protocol's verbs (cue-helper-control-v1): STATUS, TARGET, LEASE,
 * the FNaF 2 legacy readers (GET, FRAME, WATCH, READ, TRACE), REGION, SNAP,
 * AUDIO, OVERLAY and LESSON. Both listeners hand it an authorized request's
 * fields and send back the one line it returns; the capture state it reads
 * and steers stays CaptureService's.
 */
final class ControlDispatcher {
    private final CaptureService service;
    private final Object lessonLock = new Object();
    private CycleLesson.Builder pendingLesson;

    ControlDispatcher(CaptureService service) {
        this.service = service;
    }

    String dispatch(String[] field) {
        switch (field[0]) {
            case "STATUS":
                return field.length == 2 ? "OK " + service.statusLine() : "ERROR status-usage";
            case "TARGET": {
                if (field.length == 2) {
                    Targets.Target current = service.target;
                    return "OK target=" + (current == null ? "NONE" : current.packageName)
                            + " game=" + (current == null ? "NONE" : current.game)
                            + " legacy=" + (service.legacyActive() ? "fnaf2" : "OFF");
                }
                if (field.length != 3) return "ERROR target-usage";
                String refused = service.setTarget(field[2]);
                if (refused != null) return "ERROR " + refused;
                Targets.Target current = service.target;
                return "OK target=" + (current == null ? "NONE" : current.packageName)
                        + " game=" + (current == null ? "NONE" : current.game)
                        + " legacy=" + (service.legacyActive() ? "fnaf2" : "OFF");
            }
            case "LEASE":
                if (field.length != 3) return "ERROR lease-usage";
                if ("clear".equals(field[2])) {
                    service.leaseLabel = null;
                } else if (field[2].matches("[A-Za-z0-9._:@-]{1,48}")) {
                    service.leaseLabel = field[2];
                } else {
                    return "ERROR lease-label";
                }
                service.publishCombinedStatus(service.projection == null ? "UNAVAILABLE" : "RUNNING");
                return "OK lease=" + (service.leaseLabel == null ? "NONE" : service.leaseLabel);
            case "GET":
            case "FRAME":
            case "WATCH":
            case "READ":
            case "TRACE":
                if (!service.legacyActive() && !(field[0].equals("TRACE") && field.length == 3
                        && !"start".equals(field[2]))) {
                    Targets.Target current = service.target;
                    return "ERROR legacy-inactive target="
                            + (current == null ? "NONE" : current.packageName);
                }
                return dispatchLegacy(field);
            case "REGION":
                return regionControl(field);
            case "SNAP":
                return snapControl(field);
            case "AUDIO":
                return audioControl(field);
            case "OVERLAY":
                if (field.length != 2) return "ERROR overlay-usage";
                return "OK " + (service.overlayController == null
                        ? "overlay=UNAVAILABLE" : service.overlayController.status());
            case "LESSON":
                return dispatchLesson(field);
            default:
                return "ERROR unknown-verb";
        }
    }

    /** The FNaF 2 service.legacy verbs; reached only while the service.legacy readers run. */
    private String dispatchLegacy(String[] field) {
        switch (field[0]) {
            case "GET":
                // The game seeds its RNG from System.currentTimeMillis() at
                // scene load; the wall clock beside the monotonic one lets the
                // host place an image timestamp on the phone's wall clock.
                return field.length == 2 ? "OK " + service.legacy.snapshotLine(false, System.nanoTime(),
                        System.currentTimeMillis(), service.capturedContentInvalidReason(),
                        service.capturedContentWidth, service.capturedContentHeight, service.capturedContentVisibility)
                        : "ERROR get-usage";
            case "FRAME":
                return field.length == 2 ? "OK " + service.legacy.snapshotLine(true, System.nanoTime(),
                        System.currentTimeMillis(), service.capturedContentInvalidReason(),
                        service.capturedContentWidth, service.capturedContentHeight, service.capturedContentVisibility)
                        : "ERROR frame-usage";
            case "WATCH": {
                if (field.length != 3) return "ERROR watch-usage";
                String reply = service.legacy.watchCommand(field[2], service.nativeCapture());
                service.publishControlStatus();
                return reply;
            }
            case "READ":
                return field.length == 2
                        ? service.legacy.readLine(System.nanoTime(), service.capturedContentInvalidReason())
                        : "ERROR read-usage";
            case "TRACE":
                return traceControl(field);
            default:
                return "ERROR unknown-verb";
        }
    }

    private String traceControl(String[] field) {
        if (field.length < 3) return "ERROR trace-usage";
        switch (field[2]) {
            case "start":
                if (field.length != 4) return "ERROR trace-start-usage";
                // The dispatcher checked the service.target outside this lock; a TARGET
                // on the other listener may have moved it since.
                synchronized (service.targetLock) {
                    if (!service.legacyActive()) {
                        Targets.Target current = service.target;
                        return "ERROR legacy-inactive target="
                                + (current == null ? "NONE" : current.packageName);
                    }
                    return service.legacy.traceStart(field[3], new File(service.getFilesDir(), "frame-traces"),
                            service.nativeCapture(), System.nanoTime(), SystemClock.elapsedRealtimeNanos());
                }
            case "stop": {
                if (field.length != 3) return "ERROR trace-stop-usage";
                String reply = service.legacy.traceStop();
                if (reply.startsWith("ERROR trace-write")) Log.e(CaptureService.TAG, "frame trace write failed");
                return reply;
            }
            case "status":
                return field.length == 3 ? "OK " + service.legacy.traceStatus() : "ERROR trace-status-usage";
            default:
                return "ERROR trace-usage";
        }
    }

    /**
     * {@code AUDIO <token> probe <seconds> <all|package|game>},
     * {@code AUDIO <token> status}, {@code AUDIO <token> stop}: one bounded
     * AudioPlaybackCapture recording reduced on the phone to derived numbers
     * (AudioProbe); the reply never carries audio.
     */
    private String audioControl(String[] field) {
        if (field.length < 3) return "ERROR audio-usage";
        switch (field[2]) {
            case "probe": {
                if (field.length != 5 || !field[3].matches("[0-9]{1,2}")) return "ERROR audio-probe-usage";
                int uid = -1;
                String scope = "all";
                if (!"all".equals(field[4])) {
                    Targets.Target named = "target".equals(field[4]) ? service.target : Targets.resolve(field[4]);
                    if (named == null) return "ERROR audio-probe-scope";
                    try {
                        uid = service.getPackageManager().getApplicationInfo(named.packageName, 0).uid;
                    } catch (PackageManager.NameNotFoundException absent) {
                        return "ERROR target-not-installed";
                    }
                    scope = named.packageName;
                }
                String refused = service.audioProbe.start(service.projection, Integer.parseInt(field[3]), uid, scope);
                return refused == null ? "OK " + service.audioProbe.status() : "ERROR " + refused;
            }
            case "status":
                return field.length == 3 ? "OK " + service.audioProbe.status() : "ERROR audio-usage";
            case "stop":
                if (field.length != 3) return "ERROR audio-usage";
                service.audioProbe.stop();
                return "OK " + service.audioProbe.status();
            default:
                return "ERROR audio-usage";
        }
    }

    /**
     * {@code SNAP <token> <label>}: write the next native frame to
     * {@code files/frames/<label>.png}. For screens where latency does not
     * matter (title, menus, calibration); a night reads REGION instead.
     */
    private String snapControl(String[] field) {
        if (field.length != 3 || !Fnaf2Legacy.validLabel(field[2])) return "ERROR snap-usage";
        if (!service.nativeCapture()) return "ERROR snap-native-resolution-required";
        synchronized (service.snapLock) {
            CaptureService.SnapRequest request = new CaptureService.SnapRequest();
            service.snapRequest = request;
            try {
                if (!request.done.await(2000, TimeUnit.MILLISECONDS)) return "ERROR snap-no-frame";
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return "ERROR snap-interrupted";
            } finally {
                service.snapRequest = null;
            }
            File directory = new File(service.getFilesDir(), "frames");
            if (!directory.isDirectory() && !directory.mkdirs()) return "ERROR snap-directory";
            File file = new File(directory, field[2] + ".png");
            Bitmap bitmap = Bitmap.createBitmap(request.pixels, NativeFrame.WIDTH, NativeFrame.HEIGHT,
                    Bitmap.Config.ARGB_8888);
            try (FileOutputStream stream = new FileOutputStream(file)) {
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) return "ERROR snap-encode";
            } catch (IOException error) {
                return "ERROR snap-write";
            } finally {
                bitmap.recycle();
            }
            return SnapReply.ok(field[2], request.imageNs, System.nanoTime());
        }
    }

    /**
     * {@code REGION <token> set <name> <x> <y> <w> <h> <step>},
     * {@code REGION <token> clear}, {@code REGION <token> read}. A read carries
     * the helper's clock at reply time as {@code snapshotNs}, beside the
     * copied frame's {@code imageNs}, so a host can place both on its own clock.
     */
    private String regionControl(String[] field) {
        if (field.length < 3) return "ERROR region-usage";
        if (!service.nativeCapture()) {
            return "ERROR region-native-resolution-required capture="
                    + service.captureWidth + "x" + service.captureHeight;
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
                String refused = service.nativeRegions.set(field[3], v[0], v[1], v[2], v[3], v[4]);
                return refused == null ? "OK regions=" + service.nativeRegions.size() : "ERROR " + refused;
            }
            case "clear":
                service.nativeRegions.clear();
                return "OK regions=0";
            case "read":
                return "OK " + service.nativeRegions.read() + " snapshotNs=" + System.nanoTime();
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
        if (service.overlayController == null) return "ERROR overlay-unavailable";
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
                    return service.overlayController.armTeach(lesson);
                }
                case "origin": {
                    if (field.length != 5 || !field[3].matches("[0-9]{1,19}")
                            || !field[4].matches("[0-9]{1,10}")) {
                        return "ERROR lesson-origin-usage";
                    }
                    long hostOnsetNs = Long.parseLong(field[3]);
                    long afterOnsetUs = Long.parseLong(field[4]);
                    long latchNs = service.legacy.onsetNs();
                    if (latchNs == NightOnsetLatch.NOT_LATCHED) {
                        return "ERROR lesson-onset-not-latched";
                    }
                    // The host's onset is this latch read back through ms;
                    // anything further off is a different night.
                    if (Math.abs(latchNs - hostOnsetNs) > 1_000_000L) {
                        return "ERROR lesson-onset-mismatch latchNs=" + latchNs;
                    }
                    if (afterOnsetUs > 60_000_000L) return "ERROR lesson-origin-range";
                    return service.overlayController.startTeach(latchNs, afterOnsetUs);
                }
                case "clear":
                    if (field.length != 3) return "ERROR lesson-usage";
                    synchronized (lessonLock) {
                        pendingLesson = null;
                    }
                    return service.overlayController.clearTeach();
                case "status":
                    if (field.length != 3) return "ERROR lesson-usage";
                    return service.overlayController.teachStatus();
                case "f1":
                    return service.overlayController.f1Command(field, 3);
                case "f1strip":
                    return service.overlayController.f1StripCommand(field, 3);
                case "f3":
                    return service.overlayController.f3Command(field, 3);
                case "f4":
                    return service.overlayController.f4Command(field, 3);
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
}
