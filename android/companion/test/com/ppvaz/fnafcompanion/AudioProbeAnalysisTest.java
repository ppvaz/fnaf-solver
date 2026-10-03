package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

/** Synthetic signals for the playback-capture probe's derived numbers. */
public final class AudioProbeAnalysisTest {
    /** Stereo PCM: {@code seconds} of silence with a tone burst at each {@code burstMs}. */
    private static short[] signal(int rate, double seconds, int[] burstMs, int burstLenMs,
            double amplitude, double noise) {
        int frames = (int) (rate * seconds);
        short[] pcm = new short[frames * 2];
        java.util.Random random = new java.util.Random(7);
        for (int f = 0; f < frames; f++) {
            double t = f / (double) rate;
            double value = noise * (random.nextDouble() * 2 - 1);
            for (int at : burstMs) {
                double start = at / 1000.0;
                if (t >= start && t < start + burstLenMs / 1000.0) {
                    value += amplitude * Math.sin(2 * Math.PI * 880 * t);
                }
            }
            short s = (short) Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
            pcm[2 * f] = s;
            pcm[2 * f + 1] = s;
        }
        return pcm;
    }

    private static String field(String line, String key) {
        for (String token : line.split(" ")) {
            if (token.startsWith(key + "=")) return token.substring(key.length() + 1);
        }
        return null;
    }

    public static void main(String[] args) {
        AudioProbeAnalysis silence = new AudioProbeAnalysis(48_000, 2);
        short[] quiet = new short[48_000 * 2 * 2];
        silence.accept(quiet, quiet.length);
        check("two seconds of silence are 96000 frames", silence.frames() == 96_000);
        check("silence has no onset", silence.onsets() == 0);
        check("silence reads the floor", silence.rmsDbfs() <= -119.0 && silence.activeFraction() == 0.0);
        String silentLine = silence.line();
        check("a silent line says NONE, not a list", "NONE".equals(field(silentLine, "onsetMs"))
                && "2.00".equals(field(silentLine, "seconds")) && "48000".equals(field(silentLine, "rateHz")));

        // Five button clicks, as a title menu makes them: each is one onset,
        // placed within a hop or two of where it was put.
        int[] bursts = {500, 1100, 1700, 2600, 3500};
        AudioProbeAnalysis clicks = new AudioProbeAnalysis(48_000, 2);
        short[] pcm = signal(48_000, 4.0, bursts, 60, 0.3, 0.0005);
        // Fed in uneven chunks, as AudioRecord.read returns them.
        for (int at = 0; at < pcm.length; at += 3_998) {
            int count = Math.min(3_998, pcm.length - at);
            short[] chunk = new short[count];
            System.arraycopy(pcm, at, chunk, 0, count);
            clicks.accept(chunk, count);
        }
        check("each click is one onset (" + clicks.onsets() + ")", clicks.onsets() == bursts.length);
        String[] listed = field(clicks.line(), "onsetMs").split(",");
        for (int i = 0; i < bursts.length; i++) {
            long at = Long.parseLong(listed[i]);
            check("onset " + i + " at " + at + " ms is within 20 ms of " + bursts[i],
                    at >= bursts[i] - 10 && at <= bursts[i] + 20);
        }
        check("a -10 dBFS tone peaks near -10 dBFS", Math.abs(clicks.peakDbfs() + 10.5) < 1.0);
        check("clicks leave most hops quiet", clicks.activeFraction() < 0.2);

        // A continuous loud bed (a track, not events) is sound without onsets
        // after its start, and a burst below the floor is not an onset.
        AudioProbeAnalysis bed = new AudioProbeAnalysis(44_100, 2);
        short[] music = signal(44_100, 3.0, new int[] {0}, 3_000, 0.2, 0.0);
        bed.accept(music, music.length);
        check("a steady bed has at most its start as an onset", bed.onsets() <= 1);
        check("a steady bed is active throughout", bed.activeFraction() > 0.95);
        AudioProbeAnalysis faint = new AudioProbeAnalysis(48_000, 1);
        short[] whisper = signal(48_000, 2.0, new int[] {1000}, 60, 0.001, 0.0);
        short[] mono = new short[whisper.length / 2];
        for (int i = 0; i < mono.length; i++) mono[i] = whisper[2 * i];
        faint.accept(mono, mono.length);
        check("a burst below -50 dBFS is not an onset", faint.onsets() == 0);

        boolean refused = false;
        try {
            new AudioProbeAnalysis(1_000, 2);
        } catch (IllegalArgumentException expected) {
            refused = true;
        }
        check("an impossible rate is refused", refused);
        for (String token : clicks.line().split(" ")) {
            check("result token " + token + " is key=number or a list", token.matches("[a-zA-Z]+=[-0-9.,A-Z]+"));
        }

        Check.done("AudioProbeAnalysisTest: silence, clicks, a steady bed and a faint burst give the derived numbers");
    }
}
