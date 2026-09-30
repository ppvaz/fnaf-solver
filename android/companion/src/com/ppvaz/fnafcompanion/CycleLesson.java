package com.ppvaz.fnafcompanion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The executor's own night schedule, re-told as a lesson a passive observer
 * can follow on the teach panel.
 *
 * <p>The host sends the semantic actions of the compiled artifact it is about
 * to run (the same cycles and timing {@code expandNightBlocks} expands), one
 * bounded row at a time, and this class re-expands them with the same rule:
 * opening rows sit on the night timeline, the steady cycle repeats every
 * period from {@code max(loopStart, idleUntil)}, and a row runs only while its
 * instant is before {@code stopAt}. Nothing here observes the game or decides
 * an action. A lesson says what the schedule presses and when; it never says
 * what happened.</p>
 *
 * <p>The words are a fixed vocabulary keyed by verb, never host-supplied text,
 * so a caller cannot put arbitrary copy over the game. Each "why" restates a
 * sourced mechanic from packages/core (see the verb comments).</p>
 *
 * <p>Pure Java: no Android types, so android/companion/test.sh runs it on the
 * host.</p>
 */
public final class CycleLesson {
    public static final int MAX_ROWS = 48;
    public static final int MAX_NIGHT_MS = 900_000;
    /** One in-game hour on every night [SOURCED: packages/core HOUR_FRAMES, 1:10]. */
    public static final int HOUR_MS = 70_000;
    /** STUN_FRAMES 400 at 60 fps [SOURCED: packages/source/src/games/fnaf2/config.js]. */
    private static final String STUN_SECONDS = "6.7";

    /** What the schedule does. The host maps artifact actions onto these. */
    public enum Verb {
        CAMS_UP("cams-up", Ink.MONITOR),
        CAMS_DOWN("cams-down", Ink.MONITOR),
        MASK_ON("mask-on", Ink.MASK),
        MASK_OFF("mask-off", Ink.MASK),
        CAM("cam", Ink.CAM),
        HALL_LIGHT("hall-light", Ink.LIGHT),
        FEED_LIGHT("feed-light", Ink.CAM),
        WIND("wind", Ink.WIND),
        VENT_LEFT("vent-left", Ink.LIGHT),
        VENT_RIGHT("vent-right", Ink.LIGHT),
        CAMDROP("camdrop", Ink.LIGHT);

        public final String wire;
        public final Ink ink;

        Verb(String wire, Ink ink) {
            this.wire = wire;
            this.ink = ink;
        }
    }

    /** One colour per control, the trainer's lane.js scheme. */
    public enum Ink {
        MASK,
        MONITOR,
        CAM,
        LIGHT,
        WIND
    }

    /** Which of the three office surfaces the schedule intends to be on. */
    public enum Surface {
        OFFICE,
        CAMS,
        MASK
    }

    public enum Phase {
        PENDING,
        OPENING,
        CYCLE,
        FINISHED,
        EXPIRED
    }

    /** One scheduled action, on its own timeline (see {@link Timeline}). */
    public static final class Row {
        public final boolean steady;
        public final int atMs;
        public final Verb verb;
        /** Camera number for {@link Verb#CAM}, else 0. */
        public final int camera;
        public final int durationMs;
        public final int leadMs;
        public final int tailMs;

        Row(boolean steady, int atMs, Verb verb, int camera, int durationMs,
                int leadMs, int tailMs) {
            this.steady = steady;
            this.atMs = atMs;
            this.verb = verb;
            this.camera = camera;
            this.durationMs = durationMs;
            this.leadMs = leadMs;
            this.tailMs = tailMs;
        }

        /** The instant the row changes a surface; a camdrop's press follows its lead. */
        int surfaceAtMs() {
            return verb == Verb.CAMDROP ? atMs + leadMs : atMs;
        }

        int spanMs() {
            return verb == Verb.CAMDROP ? leadMs + durationMs + tailMs : durationMs;
        }

        String canonical() {
            StringBuilder out = new StringBuilder();
            out.append(steady ? "steady" : "opening").append(' ').append(atMs).append(' ')
                    .append(verb == Verb.CAM ? "cam-" + camera : verb.wire).append(' ')
                    .append(durationMs);
            if (verb == Verb.CAMDROP) out.append(' ').append(leadMs).append(' ').append(tailMs);
            return out.toString();
        }
    }

    /** A coloured span of a timeline, for the ring. */
    public static final class Arc {
        public final int startMs;
        public final int endMs;
        public final Surface surface;
        public final Ink ink;

        Arc(int startMs, int endMs, Surface surface, Ink ink) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.surface = surface;
            this.ink = ink;
        }
    }

    /**
     * The opening, or one steady cycle, with times relative to its own start.
     * The ring draws exactly this: 0 degrees is the timeline's first instant.
     */
    public static final class Timeline {
        public final int lengthMs;
        public final Row[] rows;
        /** Row times relative to the timeline start. */
        public final int[] relMs;
        /** Surface in force from each row's step onward. */
        public final Surface[] surfaceAfter;
        public final Arc[] surfaces;
        public final Arc[] actions;

        Timeline(int lengthMs, Row[] rows, int[] relMs, Surface[] surfaceAfter,
                Arc[] surfaces, Arc[] actions) {
            this.lengthMs = lengthMs;
            this.rows = rows;
            this.relMs = relMs;
            this.surfaceAfter = surfaceAfter;
            this.surfaces = surfaces;
            this.actions = actions;
        }
    }

    /** What to show at one instant. Every field is derived from the schedule. */
    public static final class Frame {
        public final Phase phase;
        public final Timeline timeline;
        public final int stepIndex;
        public final int nextIndex;
        /** Position on the timeline, 0..lengthMs. */
        public final int tMs;
        public final int stepEndMs;
        /** 1-based steady cycle, 0 in the opening. */
        public final int cycle;
        public final int cycles;
        public final int hour;

        Frame(Phase phase, Timeline timeline, int stepIndex, int nextIndex, int tMs,
                int stepEndMs, int cycle, int cycles, int hour) {
            this.phase = phase;
            this.timeline = timeline;
            this.stepIndex = stepIndex;
            this.nextIndex = nextIndex;
            this.tMs = tMs;
            this.stepEndMs = stepEndMs;
            this.cycle = cycle;
            this.cycles = cycles;
            this.hour = hour;
        }

        public Row step() {
            return timeline == null || stepIndex < 0 ? null : timeline.rows[stepIndex];
        }

        public Row next() {
            return timeline == null || nextIndex < 0 ? null : timeline.rows[nextIndex];
        }

        public int msLeft() {
            return Math.max(0, stepEndMs - tMs);
        }
    }

    public final String id;
    public final int night;
    public final int periodMs;
    public final int loopStartMs;
    public final int idleUntilMs;
    public final int stopAtMs;
    public final int observeUntilMs;
    /** The camera the feed shows while the cams are up, or 0 when not declared. */
    public final int viewCamera;
    /** The camera the marker is parked on, or 0 when not declared. */
    public final int markerCamera;
    public final Timeline opening;
    public final Timeline steady;
    /** Night-timeline instant of the first steady row. */
    public final int firstCycleAtMs;
    public final int cycles;

    private CycleLesson(String id, int night, int periodMs, int loopStartMs, int idleUntilMs,
            int stopAtMs, int observeUntilMs, int viewCamera, int markerCamera,
            Timeline opening, Timeline steady, int firstCycleAtMs, int cycles) {
        this.id = id;
        this.night = night;
        this.periodMs = periodMs;
        this.loopStartMs = loopStartMs;
        this.idleUntilMs = idleUntilMs;
        this.stopAtMs = stopAtMs;
        this.observeUntilMs = observeUntilMs;
        this.viewCamera = viewCamera;
        this.markerCamera = markerCamera;
        this.opening = opening;
        this.steady = steady;
        this.firstCycleAtMs = firstCycleAtMs;
        this.cycles = cycles;
    }

    /**
     * The lesson at {@code tMs} after the schedule's origin. {@code nightMs}
     * is the same instant measured from the night's latched onset, which is
     * what the game's clock counts; the origin sits a measured aim after it.
     */
    public Frame frameAt(long tMs, long nightMs) {
        int hour = hourOf(nightMs);
        if (tMs < 0L) {
            return new Frame(Phase.PENDING, null, -1, -1, 0, 0, 0, cycles, hour);
        }
        if (tMs >= observeUntilMs) {
            return new Frame(Phase.EXPIRED, null, -1, -1, 0, 0, 0, cycles, hour);
        }
        if (tMs >= stopAtMs) {
            // The schedule issues nothing at or after stopAt.
            return new Frame(Phase.FINISHED, null, -1, -1, 0, 0, cycles, cycles, hour);
        }
        if (tMs < firstCycleAtMs) {
            int t = (int) tMs;
            int step = lastAtOrBefore(opening, t, opening.rows.length);
            if (step < 0) {
                // Nothing has run yet: the first opening row is still ahead.
                return new Frame(Phase.OPENING, opening, -1, 0, t, opening.relMs[0], 0, cycles, hour);
            }
            int next = step + 1 < opening.rows.length ? step + 1 : -1;
            int end = next >= 0 ? opening.relMs[next] : opening.lengthMs;
            return new Frame(Phase.OPENING, opening, step, next, t, end, 0, cycles, hour);
        }
        long intoCycles = tMs - firstCycleAtMs;
        int k = (int) (intoCycles / periodMs);
        if (k >= cycles) {
            return new Frame(Phase.FINISHED, null, -1, -1, 0, 0, cycles, cycles, hour);
        }
        int t = (int) (intoCycles - (long) k * periodMs);
        int executed = executedRows(k);
        int step = lastAtOrBefore(steady, t, executed);
        if (step < 0) {
            return new Frame(Phase.FINISHED, null, -1, -1, 0, 0, cycles, cycles, hour);
        }
        int next;
        int end;
        if (step + 1 < executed) {
            next = step + 1;
            end = steady.relMs[next];
        } else if (k + 1 < cycles) {
            // The next step is the following cycle's first row.
            next = 0;
            end = steady.lengthMs;
        } else {
            next = -1;
            end = steady.lengthMs;
        }
        return new Frame(Phase.CYCLE, steady, step, next, t, end, k + 1, cycles, hour);
    }

    /** Rows of steady instance {@code k} whose instant is before stopAt. */
    private int executedRows(int k) {
        long base = (long) firstCycleAtMs + (long) k * periodMs;
        int count = 0;
        for (int i = 0; i < steady.rows.length; i++) {
            if (base + steady.relMs[i] < stopAtMs) count++;
        }
        return count;
    }

    private static int lastAtOrBefore(Timeline timeline, int t, int limit) {
        int found = -1;
        for (int i = 0; i < limit; i++) {
            if (timeline.relMs[i] <= t) found = i;
        }
        return found;
    }

    static int hourOf(long tMs) {
        return (int) Math.min(6L, Math.max(0L, tMs) / HOUR_MS);
    }

    /** "12 AM" .. "6 AM", the game's own clock labels. */
    public static String hourLabel(int hour) {
        return (hour <= 0 ? 12 : hour) + " AM";
    }

    /** Short imperative-free title for a row. */
    public String title(Row row) {
        switch (row.verb) {
            case CAMS_UP: return "CAMS UP";
            case CAMS_DOWN: return "CAMS DOWN";
            case MASK_ON: return "MASK ON";
            case MASK_OFF: return "MASK OFF";
            case CAM: return String.format(Locale.US, "CAM %02d", row.camera);
            case HALL_LIGHT: return "HALL FLASH";
            case FEED_LIGHT: return "CAM FLASH";
            case WIND: return "WIND";
            case VENT_LEFT: return "LEFT VENT";
            case VENT_RIGHT: return "RIGHT VENT";
            case CAMDROP: return "DROP + LIGHT";
            default: throw new IllegalStateException("unmapped verb " + row.verb);
        }
    }

    /** Why the row is in the schedule, from the fixed vocabulary. */
    public String why(Row row) {
        switch (row.verb) {
            case CAMS_UP:
                if (viewCamera > 0 && markerCamera > 0 && markerCamera != viewCamera) {
                    return String.format(Locale.US, "feed CAM %02d, marker on %02d",
                            viewCamera, markerCamera);
                }
                return viewCamera > 0
                        ? String.format(Locale.US, "feed on CAM %02d", viewCamera)
                        : "open the camera feed";
            case CAMS_DOWN:
                return "back to the office";
            case MASK_ON:
                // RESOLVE_ORDER_DEFENDED and the vent-occupant hold (core config.js).
                return "visitors in the office leave";
            case MASK_OFF:
                // g75: `lit?` needs mask = 0, and the monitor needs the mask off.
                return "lights and cams need it off";
            case CAM:
                return roomName(row.camera);
            case HALL_LIGHT:
                // g745: the hall latch zeroes Foxy's D.
                return "resets Foxy's charge";
            case FEED_LIGHT:
                // Groups 450-457: the flash stuns whoever the marker overlaps.
                return markerCamera > 0
                        ? String.format(Locale.US, "freezes CAM %02d for %s s",
                                markerCamera, STUN_SECONDS)
                        : "freezes the marked camera " + STUN_SECONDS + " s";
            case WIND:
                return "keeps the Puppet in its box";
            case VENT_LEFT:
                return "lights the left vent";
            case VENT_RIGHT:
                return "lights the right vent";
            case CAMDROP:
                // g489: the light held through the drop latches the hall light.
                return "held light flashes the hall";
            default:
                throw new IllegalStateException("unmapped verb " + row.verb);
        }
    }

    static String roomName(int camera) {
        switch (camera) {
            case 1: return "Party Room 1";
            case 2: return "Party Room 2";
            case 3: return "Party Room 3";
            case 4: return "Party Room 4";
            case 5: return "Left Air Vent";
            case 6: return "Right Air Vent";
            case 7: return "Main Hall";
            case 8: return "Parts/Service";
            case 9: return "Show Stage";
            case 10: return "Game Area";
            case 11: return "Prize Corner";
            case 12: return "Kid's Cove";
            default: throw new IllegalArgumentException("camera out of range");
        }
    }

    public String status() {
        return "lesson=" + id + " night=" + night + " period=" + periodMs
                + " cycles=" + cycles + " rows=" + (opening.rows.length + steady.rows.length);
    }

    /**
     * Collects one lesson from bounded protocol lines. {@link #build()} refuses
     * any lesson that is incomplete, out of order, not periodic, or whose rows
     * do not hash to the id the host declared.
     */
    public static final class Builder {
        private final String declaredId;
        private final int night;
        private final int periodMs;
        private final int loopStartMs;
        private final int idleUntilMs;
        private final int stopAtMs;
        private final int observeUntilMs;
        private final int rowCount;
        private final int viewCamera;
        private final int markerCamera;
        private final Row[] rows;

        /** {@code begin} fields, in wire order after the verb. */
        public static Builder begin(String[] field, int offset) {
            if (field == null || field.length - offset != 10) {
                throw new IllegalArgumentException("lesson-begin-usage");
            }
            String id = field[offset];
            if (!id.matches("[0-9a-f]{16}")) throw new IllegalArgumentException("lesson-id");
            return new Builder(id,
                    bounded(field[offset + 1], 1, 7, "lesson-night"),
                    bounded(field[offset + 2], 1_000, 60_000, "lesson-period"),
                    bounded(field[offset + 3], 0, MAX_NIGHT_MS, "lesson-loop-start"),
                    bounded(field[offset + 4], 0, MAX_NIGHT_MS, "lesson-idle-until"),
                    bounded(field[offset + 5], 1, MAX_NIGHT_MS, "lesson-stop-at"),
                    bounded(field[offset + 6], 1, MAX_NIGHT_MS, "lesson-observe-until"),
                    bounded(field[offset + 7], 1, MAX_ROWS, "lesson-rows"),
                    camera(field[offset + 8], "lesson-view"),
                    camera(field[offset + 9], "lesson-marker"));
        }

        Builder(String declaredId, int night, int periodMs, int loopStartMs, int idleUntilMs,
                int stopAtMs, int observeUntilMs, int rowCount, int viewCamera, int markerCamera) {
            if (stopAtMs <= loopStartMs || observeUntilMs < stopAtMs) {
                throw new IllegalArgumentException("lesson-bounds");
            }
            this.declaredId = declaredId;
            this.night = night;
            this.periodMs = periodMs;
            this.loopStartMs = loopStartMs;
            this.idleUntilMs = idleUntilMs;
            this.stopAtMs = stopAtMs;
            this.observeUntilMs = observeUntilMs;
            this.rowCount = rowCount;
            this.viewCamera = viewCamera;
            this.markerCamera = markerCamera;
            this.rows = new Row[rowCount];
        }

        /** {@code row} fields after the verb: index cycle atMs verb durationMs [leadMs tailMs]. */
        public void row(String[] field, int offset) {
            int length = field == null ? 0 : field.length - offset;
            if (length != 5 && length != 7) throw new IllegalArgumentException("lesson-row-usage");
            int index = bounded(field[offset], 0, rowCount - 1, "lesson-row-index");
            if (rows[index] != null) throw new IllegalArgumentException("lesson-row-duplicate");
            boolean steady;
            if ("opening".equals(field[offset + 1])) {
                steady = false;
            } else if ("steady".equals(field[offset + 1])) {
                steady = true;
            } else {
                throw new IllegalArgumentException("lesson-row-cycle");
            }
            int atMs = bounded(field[offset + 2], 0, MAX_NIGHT_MS, "lesson-row-at");
            String verbToken = field[offset + 3];
            Verb verb = null;
            int camera = 0;
            if (verbToken.startsWith("cam-")) {
                verb = Verb.CAM;
                camera = bounded(verbToken.substring(4), 1, 12, "lesson-row-camera");
            } else {
                for (Verb candidate : Verb.values()) {
                    if (candidate != Verb.CAM && candidate.wire.equals(verbToken)) verb = candidate;
                }
            }
            if (verb == null) throw new IllegalArgumentException("lesson-row-verb");
            int durationMs = bounded(field[offset + 4], 1, periodMs, "lesson-row-duration");
            int leadMs = 0;
            int tailMs = 0;
            if (verb == Verb.CAMDROP) {
                if (length != 7) throw new IllegalArgumentException("lesson-row-camdrop");
                leadMs = bounded(field[offset + 5], 0, periodMs, "lesson-row-lead");
                tailMs = bounded(field[offset + 6], 0, periodMs, "lesson-row-tail");
            } else if (length != 5) {
                throw new IllegalArgumentException("lesson-row-usage");
            }
            rows[index] = new Row(steady, atMs, verb, camera, durationMs, leadMs, tailMs);
        }

        public CycleLesson build() {
            List<Row> openingRows = new ArrayList<>();
            List<Row> steadyRows = new ArrayList<>();
            for (Row row : rows) {
                if (row == null) throw new IllegalArgumentException("lesson-incomplete");
                if (row.steady) {
                    steadyRows.add(row);
                } else if (!steadyRows.isEmpty()) {
                    throw new IllegalArgumentException("lesson-opening-after-steady");
                } else {
                    openingRows.add(row);
                }
            }
            if (openingRows.isEmpty() || steadyRows.isEmpty()) {
                throw new IllegalArgumentException("lesson-needs-opening-and-steady");
            }
            requireOrdered(openingRows);
            requireOrdered(steadyRows);
            int steadyFirst = steadyRows.get(0).atMs;
            int start = Math.max(loopStartMs, idleUntilMs);
            int firstCycleAtMs = start + steadyFirst;
            for (Row row : steadyRows) {
                if (row.atMs - steadyFirst + row.spanMs() > periodMs) {
                    throw new IllegalArgumentException("lesson-steady-exceeds-period");
                }
            }
            Row lastOpening = openingRows.get(openingRows.size() - 1);
            if (lastOpening.atMs + lastOpening.spanMs() > firstCycleAtMs) {
                throw new IllegalArgumentException("lesson-opening-overlaps-cycle");
            }
            if (firstCycleAtMs >= stopAtMs) {
                throw new IllegalArgumentException("lesson-no-cycle-before-stop");
            }
            int cycles = 0;
            while ((long) firstCycleAtMs + (long) cycles * periodMs < stopAtMs) cycles++;

            Surface start0 = Surface.OFFICE;
            Timeline opening = timeline(openingRows, 0, firstCycleAtMs, start0);
            Surface openingEnd = opening.surfaceAfter[opening.surfaceAfter.length - 1];
            Timeline steady = timeline(steadyRows, steadyFirst, periodMs, openingEnd);
            if (steady.surfaceAfter[steady.surfaceAfter.length - 1] != openingEnd) {
                throw new IllegalArgumentException("lesson-not-periodic");
            }
            String computed = digest(canonical(openingRows, steadyRows));
            if (!computed.equals(declaredId)) {
                throw new IllegalArgumentException("lesson-id-mismatch computed=" + computed);
            }
            return new CycleLesson(declaredId, night, periodMs, loopStartMs, idleUntilMs,
                    stopAtMs, observeUntilMs, viewCamera, markerCamera, opening, steady,
                    firstCycleAtMs, cycles);
        }

        String canonical(List<Row> openingRows, List<Row> steadyRows) {
            StringBuilder out = new StringBuilder();
            out.append("lesson-v1 ").append(night).append(' ').append(periodMs).append(' ')
                    .append(loopStartMs).append(' ').append(idleUntilMs).append(' ')
                    .append(stopAtMs).append(' ').append(observeUntilMs).append(' ')
                    .append(viewCamera > 0 ? String.valueOf(viewCamera) : "-").append(' ')
                    .append(markerCamera > 0 ? String.valueOf(markerCamera) : "-").append('\n');
            for (Row row : openingRows) out.append(row.canonical()).append('\n');
            for (Row row : steadyRows) out.append(row.canonical()).append('\n');
            return out.toString();
        }

        private static void requireOrdered(List<Row> rows) {
            int previous = -1;
            for (Row row : rows) {
                if (row.atMs < previous) throw new IllegalArgumentException("lesson-row-order");
                previous = row.atMs;
            }
        }

        /**
         * Replays the surfaces a timeline's rows intend, starting from
         * {@code initial}. The mask and the monitor are exclusive in this
         * vocabulary: raising the cams under a worn mask, or masking with the
         * cams up, is refused rather than drawn.
         */
        private static Timeline timeline(List<Row> list, int originMs, int lengthMs,
                Surface initial) {
            int n = list.size();
            Row[] rows = list.toArray(new Row[0]);
            int[] rel = new int[n];
            Surface[] after = new Surface[n];
            Surface surface = initial;
            List<Arc> surfaces = new ArrayList<>();
            List<Arc> actions = new ArrayList<>();
            int surfaceFrom = 0;
            for (int i = 0; i < n; i++) {
                Row row = rows[i];
                rel[i] = row.atMs - originMs;
                Surface next = surface;
                switch (row.verb) {
                    case CAMS_UP:
                        if (surface == Surface.MASK) throw new IllegalArgumentException("lesson-cams-under-mask");
                        next = Surface.CAMS;
                        break;
                    case CAMS_DOWN:
                    case CAMDROP:
                        if (surface != Surface.CAMS) throw new IllegalArgumentException("lesson-drop-without-cams");
                        next = Surface.OFFICE;
                        break;
                    case MASK_ON:
                        if (surface == Surface.CAMS) throw new IllegalArgumentException("lesson-mask-over-cams");
                        next = Surface.MASK;
                        break;
                    case MASK_OFF:
                        if (surface != Surface.MASK) throw new IllegalArgumentException("lesson-unmask-without-mask");
                        next = Surface.OFFICE;
                        break;
                    default:
                        break;
                }
                if (next != surface) {
                    int at = row.surfaceAtMs() - originMs;
                    if (at > surfaceFrom) surfaces.add(new Arc(surfaceFrom, at, surface, null));
                    surfaceFrom = Math.max(surfaceFrom, at);
                    surface = next;
                }
                after[i] = surface;
                if (row.verb != Verb.CAMS_UP && row.verb != Verb.CAMS_DOWN
                        && row.verb != Verb.MASK_ON && row.verb != Verb.MASK_OFF) {
                    actions.add(new Arc(rel[i], Math.min(lengthMs, rel[i] + row.spanMs()),
                            null, row.verb.ink));
                }
            }
            if (lengthMs > surfaceFrom) surfaces.add(new Arc(surfaceFrom, lengthMs, surface, null));
            return new Timeline(lengthMs, rows, rel, after,
                    surfaces.toArray(new Arc[0]), actions.toArray(new Arc[0]));
        }
    }

    static String digest(String canonical) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.US_ASCII));
            StringBuilder out = new StringBuilder(16);
            for (int i = 0; i < 8; i++) out.append(String.format(Locale.US, "%02x", hash[i]));
            return out.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private static int bounded(String token, int min, int max, String reason) {
        if (token == null || !token.matches("[0-9]{1,7}")) throw new IllegalArgumentException(reason);
        int value = Integer.parseInt(token);
        if (value < min || value > max) throw new IllegalArgumentException(reason);
        return value;
    }

    private static int camera(String token, String reason) {
        if ("-".equals(token)) return 0;
        return bounded(token, 1, 12, reason);
    }
}
