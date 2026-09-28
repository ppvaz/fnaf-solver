package com.ppvaz.fnafcompanion;

import java.util.Locale;

/**
 * Derived numbers from one bounded playback-capture recording -- never the
 * audio itself.
 *
 * <p>The Companion's {@code AUDIO probe} records the phone's own playback
 * through AudioPlaybackCapture for a few seconds and keeps only what this
 * class computes: sample rate, channels, duration, RMS and peak level, the
 * fraction of 10 ms hops that carry sound, and the discrete onsets (a hop
 * whose energy jumps at least {@link #ONSET_RISE_DB} above the mean of the
 * preceding {@link #ONSET_CONTEXT_MS} ms, above {@link #ONSET_FLOOR_DBFS},
 * at most one per {@link #ONSET_REFRACTORY_MS} ms). The question it answers is
 * whether a capture path contains a game's discrete SFX at all -- retail
 * FNaF on this phone plays through the FAST output, which playback capture
 * does not expose; the FNaF 2 rebuild can move its audio to DEEP_BUFFER
 * ({@code debug.rebuild.audio_capture}). A silent capture is reported as
 * silent, never as "no event".</p>
 *
 * <p>Pure Java, host-tested by {@code AudioProbeAnalysisTest}.</p>
 */
public final class AudioProbeAnalysis {
    public static final int HOP_MS = 10;
    public static final double ONSET_RISE_DB = 9.0;
    public static final int ONSET_CONTEXT_MS = 200;
    public static final double ONSET_FLOOR_DBFS = -50.0;
    public static final int ONSET_REFRACTORY_MS = 80;
    public static final double ACTIVE_FLOOR_DBFS = -60.0;
    /** Onset times reported in the result line; the count covers them all. */
    public static final int MAX_LISTED_ONSETS = 24;

    private final int sampleRateHz;
    private final int channels;
    private final int hopFrames;
    private final int contextHops;
    private final int refractoryHops;
    private final double[] context;
    private int contextCount;
    private int contextAt;
    private double hopEnergy;
    private int hopFill;
    private long frames;
    private long hops;
    private long activeHops;
    private double sumSquares;
    private long samples;
    private int peak;
    private int onsets;
    private long lastOnsetHop = Long.MIN_VALUE / 2;
    private final long[] onsetMs = new long[MAX_LISTED_ONSETS];

    public AudioProbeAnalysis(int sampleRateHz, int channels) {
        if (sampleRateHz < 8_000 || sampleRateHz > 192_000 || channels < 1 || channels > 8) {
            throw new IllegalArgumentException("audio format out of range");
        }
        this.sampleRateHz = sampleRateHz;
        this.channels = channels;
        this.hopFrames = sampleRateHz * HOP_MS / 1000;
        this.contextHops = ONSET_CONTEXT_MS / HOP_MS;
        this.refractoryHops = ONSET_REFRACTORY_MS / HOP_MS;
        this.context = new double[contextHops];
    }

    /** Feed interleaved signed 16-bit PCM samples, {@code count} of them (a multiple of channels). */
    public void accept(short[] pcm, int count) {
        for (int i = 0; i + channels <= count; i += channels) {
            long mono = 0;
            for (int c = 0; c < channels; c++) {
                int sample = pcm[i + c];
                mono += sample;
                int magnitude = Math.abs(sample);
                if (magnitude > peak) peak = magnitude;
                sumSquares += (double) sample * sample;
                samples++;
            }
            double m = (double) mono / channels;
            hopEnergy += m * m;
            hopFill++;
            frames++;
            if (hopFill == hopFrames) endHop();
        }
    }

    private void endHop() {
        double meanSquare = hopEnergy / hopFrames;
        double db = dbfs(Math.sqrt(meanSquare));
        if (db > ACTIVE_FLOOR_DBFS) activeHops++;
        if (contextCount == contextHops) {
            double contextMean = 0;
            for (double value : context) contextMean += value;
            contextMean /= contextHops;
            double riseDb = 10.0 * Math.log10((meanSquare + 1e-9) / (contextMean + 1e-9));
            if (db > ONSET_FLOOR_DBFS && riseDb >= ONSET_RISE_DB
                    && hops - lastOnsetHop >= refractoryHops) {
                if (onsets < MAX_LISTED_ONSETS) onsetMs[onsets] = hops * HOP_MS;
                onsets++;
                lastOnsetHop = hops;
            }
        }
        context[contextAt] = meanSquare;
        contextAt = (contextAt + 1) % contextHops;
        if (contextCount < contextHops) contextCount++;
        hops++;
        hopEnergy = 0;
        hopFill = 0;
    }

    private static double dbfs(double rms) {
        return rms <= 0 ? -120.0 : Math.max(-120.0, 20.0 * Math.log10(rms / 32768.0));
    }

    public long frames() { return frames; }

    public int onsets() { return onsets; }

    public double rmsDbfs() {
        return samples == 0 ? -120.0 : dbfs(Math.sqrt(sumSquares / samples));
    }

    public double peakDbfs() {
        return dbfs(peak);
    }

    public double activeFraction() {
        return hops == 0 ? 0.0 : activeHops / (double) hops;
    }

    /** The result as status tokens: every value a derived number, no audio. */
    public String line() {
        StringBuilder list = new StringBuilder();
        for (int i = 0; i < Math.min(onsets, MAX_LISTED_ONSETS); i++) {
            if (i > 0) list.append(',');
            list.append(onsetMs[i]);
        }
        return String.format(Locale.US,
                "rateHz=%d channels=%d seconds=%.2f frames=%d rmsDbfs=%.1f peakDbfs=%.1f"
                        + " activeFraction=%.3f onsets=%d onsetMs=%s",
                sampleRateHz, channels, frames / (double) sampleRateHz, frames,
                rmsDbfs(), peakDbfs(), activeFraction(), onsets,
                onsets == 0 ? "NONE" : list.toString());
    }
}
