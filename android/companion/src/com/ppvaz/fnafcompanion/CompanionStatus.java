package com.ppvaz.fnafcompanion;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The Companion's versioned status line and endpoint handshake.
 *
 * <p>{@code STATUS <token>} answers {@code OK <line>}, where the line is one
 * space-separated run of {@code key=value} tokens in a fixed order, the first
 * always {@code schema=companion-status-v1}. Every value is a bounded token --
 * no space, no {@code =} -- and a measurement that is missing or ambiguous is
 * {@code UNKNOWN}, never a guess. The same line is broadcast to the activity,
 * which renders it, and logged. The host parser is
 * {@code packages/play/src/venues/phone/companion-status.ts}; both sides
 * are held to {@code packages/play/test/testdata/companion-status-v1.txt}.</p>
 *
 * <p>The endpoint handshake replaces scraping logcat for the per-session
 * token: the service writes {@code files/companion-endpoint.properties}
 * (schema {@code companion-endpoint-v1}) when its control socket opens and
 * deletes it when capture stops, so a host reads it with {@code run-as}
 * however long the session has run.</p>
 *
 * <p>Pure Java, host-tested by {@code CompanionStatusTest}.</p>
 */
public final class CompanionStatus {
    public static final String SCHEMA = "companion-status-v1";
    public static final String ENDPOINT_SCHEMA = "companion-endpoint-v1";
    public static final String ENDPOINT_FILE = "companion-endpoint.properties";
    public static final String UNKNOWN = "UNKNOWN";

    /** Every field, in wire order. Adding one is a new minor field; removing or renaming one is a new schema. */
    public static final String[] FIELDS = {
            "schema", "app", "code", "session", "capture", "captureReason",
            "content", "visible", "frames", "frameAgeMs", "fps",
            "target", "game", "targetBuild", "legacy",
            "regions", "regionSamples", "regionFrames",
            "lesson", "lessonState", "panel", "clearance", "overlayPermission",
            "lease", "battery", "charging", "thermal", "foreground", "audioProbe",
            "snapshotNs", "wallMs",
    };

    private final Map<String, String> values = new LinkedHashMap<>();

    public CompanionStatus() {
        for (String field : FIELDS) values.put(field, UNKNOWN);
        values.put("schema", SCHEMA);
    }

    /**
     * The value of the first {@code key=} token anywhere in the service's
     * multi-line status broadcast, or {@link #UNKNOWN}. The screen label rides
     * inside the {@code visual=} line, so a line-start match never finds it.
     */
    public static String broadcastField(String broadcast, String key) {
        if (broadcast == null) return UNKNOWN;
        String prefix = key + "=";
        for (String line : broadcast.split("\n")) {
            for (String token : line.split(" ")) {
                if (token.startsWith(prefix)) return token.substring(prefix.length());
            }
        }
        return UNKNOWN;
    }

    /** Set one field; the value is reduced to a bounded token. */
    public CompanionStatus put(String field, String value) {
        if (!values.containsKey(field) || "schema".equals(field)) {
            throw new IllegalArgumentException("unknown status field " + field);
        }
        values.put(field, token(value));
        return this;
    }

    public CompanionStatus put(String field, long value) {
        return put(field, Long.toString(value));
    }

    public String get(String field) {
        return values.get(field);
    }

    /** The wire line: every field, in order. */
    public String line() {
        StringBuilder out = new StringBuilder(512);
        for (String field : FIELDS) {
            if (out.length() > 0) out.append(' ');
            out.append(field).append('=').append(values.get(field));
        }
        return out.toString();
    }

    /**
     * A value as a status token: 1..96 printable ASCII characters without a
     * space or {@code =}. Anything else is {@code UNKNOWN} -- a value this
     * line cannot carry faithfully is not carried at all.
     */
    public static String token(String value) {
        if (value == null || value.isEmpty() || value.length() > 96) return UNKNOWN;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= 0x20 || c >= 0x7f || c == '=') return UNKNOWN;
        }
        return value;
    }

    /**
     * Parse a status line (with or without the {@code OK } prefix) into its
     * fields, refusing a line of another schema. Unknown keys are kept, so a
     * newer writer's additions reach a reader that ignores them.
     */
    public static Map<String, String> parse(String line) {
        if (line == null) throw new IllegalArgumentException("status line is null");
        String text = line.trim();
        if (text.startsWith("OK ")) text = text.substring(3);
        Map<String, String> fields = new LinkedHashMap<>();
        for (String part : text.split(" +")) {
            int at = part.indexOf('=');
            if (at <= 0) continue;
            fields.put(part.substring(0, at), part.substring(at + 1));
        }
        if (!SCHEMA.equals(fields.get("schema"))) {
            throw new IllegalArgumentException("not a " + SCHEMA + " line");
        }
        return fields;
    }

    /** The endpoint file's text, one {@code key=value} per line. */
    public static String endpointProperties(String app, long code, long session, int pid,
            int port, String socket, String token) {
        return "schema=" + ENDPOINT_SCHEMA + "\n"
                + "app=" + token(app) + "\n"
                + "code=" + code + "\n"
                + "session=" + session + "\n"
                + "pid=" + pid + "\n"
                + "port=" + port + "\n"
                + "socket=" + token(socket) + "\n"
                + "token=" + token(token) + "\n";
    }

    /** The one logcat line that announces the same endpoint, for a host with no run-as. */
    public static String endpointLogLine(String app, long code, long session, int pid,
            int port, String socket, String token) {
        return "COMPANION schema=" + ENDPOINT_SCHEMA + " app=" + token(app) + " code=" + code
                + " session=" + session + " pid=" + pid + " port=" + port
                + " socket=" + token(socket) + " token=" + token(token);
    }

    /** Android's thermal status constant as its status word. */
    public static String thermalWord(int status) {
        switch (status) {
            case 0: return "NONE";
            case 1: return "LIGHT";
            case 2: return "MODERATE";
            case 3: return "SEVERE";
            case 4: return "CRITICAL";
            case 5: return "EMERGENCY";
            case 6: return "SHUTDOWN";
            default: return UNKNOWN;
        }
    }
}
