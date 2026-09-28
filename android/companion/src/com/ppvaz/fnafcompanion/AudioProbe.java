package com.ppvaz.fnafcompanion;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

/**
 * One bounded AudioPlaybackCapture recording through the active projection,
 * reduced on the phone to {@link AudioProbeAnalysis}'s derived numbers.
 *
 * <p>{@code AUDIO <token> probe <seconds> <all|package|game>} starts it,
 * {@code AUDIO <token> status} reads it, {@code AUDIO <token> stop} ends it
 * early. The PCM stays in memory for the length of one read and is never
 * written, sent or retained: the reply carries rate, channels, duration,
 * RMS/peak level, active fraction and onset count/times only. It needs
 * RECORD_AUDIO (granted in the Companion or with {@code pm grant}); without
 * it, or when the platform refuses the capture, the probe reports ERROR with
 * the reason. A capture policy that excludes the game yields a silent result,
 * which says so -- it is never read as "no event happened".</p>
 */
final class AudioProbe {
    static final int MAX_SECONDS = 30;
    private static final String TAG = "FnafCueHelper";
    private static final int RATE_HZ = 48_000;

    private final Context context;
    private final Runnable changed;
    private volatile String state = "OFF";
    private volatile String detail = "";
    private volatile boolean running;
    private volatile long startedMs;
    private volatile String scope = "NONE";
    private Thread worker;

    AudioProbe(Context context, Runnable changed) {
        this.context = context.getApplicationContext();
        this.changed = changed;
    }

    /** OFF, RUNNING, DONE or ERROR, for the status line. */
    String state() {
        return state;
    }

    /** {@code audioProbe=<state> scope=<scope> ...} with the derived numbers once DONE. */
    String status() {
        String line = "audioProbe=" + state + " scope=" + scope;
        if ("RUNNING".equals(state)) {
            return line + " elapsedMs=" + (SystemClock.elapsedRealtime() - startedMs);
        }
        return detail.isEmpty() ? line : line + " " + detail;
    }

    /**
     * Start a probe of {@code seconds} over {@code projection}, capturing every
     * app's media/game/unknown playback, or only {@code uid}'s when it is not -1.
     * Returns null, or the refusal.
     */
    synchronized String start(MediaProjection projection, int seconds, int uid, String scopeName) {
        if (projection == null) return "audio-no-projection";
        if (running || (worker != null && worker.isAlive())) return "audio-probe-busy";
        if (seconds < 1 || seconds > MAX_SECONDS) return "audio-probe-seconds";
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            return "audio-record-permission";
        }
        running = true;
        state = "RUNNING";
        detail = "";
        scope = scopeName;
        startedMs = SystemClock.elapsedRealtime();
        worker = new Thread(() -> record(projection, seconds, uid), "companion-audio-probe");
        worker.start();
        changed.run();
        return null;
    }

    synchronized void stop() {
        running = false;
    }

    private void record(MediaProjection projection, int seconds, int uid) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        AudioRecord recorder = null;
        String finalState = "ERROR";
        String finalDetail;
        try {
            AudioPlaybackCaptureConfiguration.Builder builder =
                    new AudioPlaybackCaptureConfiguration.Builder(projection)
                            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                            .addMatchingUsage(AudioAttributes.USAGE_GAME)
                            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN);
            if (uid >= 0) builder.addMatchingUid(uid);
            AudioFormat format = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE_HZ)
                    .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                    .build();
            int minimum = AudioRecord.getMinBufferSize(RATE_HZ, AudioFormat.CHANNEL_IN_STEREO,
                    AudioFormat.ENCODING_PCM_16BIT);
            recorder = new AudioRecord.Builder()
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(Math.max(minimum, RATE_HZ * 4 / 5))
                    .setAudioPlaybackCaptureConfig(builder.build())
                    .build();
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("audio-record-not-initialized");
            }
            AudioProbeAnalysis analysis = new AudioProbeAnalysis(recorder.getSampleRate(),
                    recorder.getChannelCount());
            long wanted = (long) seconds * recorder.getSampleRate();
            long deadlineMs = SystemClock.elapsedRealtime() + (seconds + 5L) * 1000L;
            short[] buffer = new short[recorder.getSampleRate() / 10 * recorder.getChannelCount()];
            recorder.startRecording();
            while (running && analysis.frames() < wanted) {
                if (SystemClock.elapsedRealtime() >= deadlineMs)
                    throw new IllegalStateException("audio-probe-deadline");
                int read = recorder.read(buffer, 0, buffer.length, AudioRecord.READ_NON_BLOCKING);
                if (read == 0) {
                    SystemClock.sleep(10);
                    continue;
                }
                if (read < 0) throw new IllegalStateException("audio-read-" + read);
                analysis.accept(buffer, read);
            }
            finalState = "DONE";
            finalDetail = analysis.line() + (running ? "" : " stopped=1");
        } catch (RuntimeException error) {
            Log.w(TAG, "audio probe failed", error);
            String message = error.getMessage() == null ? error.getClass().getSimpleName()
                    : error.getMessage();
            finalDetail = "reason=" + CompanionStatus.token(message.replace(' ', '-'));
        } finally {
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (IllegalStateException ignored) {
                    // It may never have started.
                }
                recorder.release();
            }
        }
        synchronized (this) {
            running = false;
            state = finalState;
            detail = finalDetail;
        }
        Log.i(TAG, status());
        changed.run();
    }
}
