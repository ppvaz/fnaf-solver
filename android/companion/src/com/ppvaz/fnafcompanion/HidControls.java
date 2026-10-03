package com.ppvaz.fnafcompanion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;

/**
 * The raw HID coordinates of a route's controls, as its bundle carries them.
 *
 * <p>The host derives {@code hid-controls.txt} from the device profile beside it
 * ({@code packages/play/src/venues/phone/hid.ts} {@code hidControlsText}, the
 * transport that presses the phone from the host) and names that profile and its
 * sha256. The runner holds no geometry of its own: until 2026-09-30
 * {@link NightRunner} kept a copy of the control map and of the screen transform,
 * and a host test held the two copies to one answer. A file bound to another
 * profile, a control off the HID axes, and a plan control the file does not name
 * are refused. Pure Java; {@code HidControlsTest} holds it on the host.</p>
 */
public final class HidControls {
    public static final String SCHEMA = "hid-controls-v1";
    public static final String FILE = "hid-controls.txt";
    /** The descriptor's Logical Maximum on each axis. */
    private static final int[] RAW_MAX = {2399, 1079};

    public final String profileId;
    public final String profileSha256;
    private final Map<String, int[]> raw;

    private HidControls(String profileId, String profileSha256, Map<String, int[]> raw) {
        this.profileId = profileId;
        this.profileSha256 = profileSha256;
        this.raw = raw;
    }

    /**
     * Reads the file, refusing it unless it is this schema and was derived from
     * the profile whose bytes hash to {@code profileSha256}.
     */
    public static HidControls parse(String text, String profileSha256) throws IOException {
        if (text == null) throw new IOException(FILE + " is missing");
        String schema = null;
        String profile = null;
        String bound = null;
        Map<String, int[]> raw = new HashMap<>();
        for (String line : text.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            String[] fields = trimmed.split("\\s+");
            if (trimmed.startsWith("#")) {
                if (fields.length != 2) throw new IOException(FILE + " header is malformed: " + trimmed);
                switch (fields[0]) {
                    case "#schema": schema = fields[1]; break;
                    case "#profile": profile = fields[1]; break;
                    case "#profile-sha256": bound = fields[1]; break;
                    default: throw new IOException(FILE + " has an unknown header: " + fields[0]);
                }
                continue;
            }
            if (fields.length != 3) throw new IOException(FILE + " control line is malformed: " + trimmed);
            int[] point = {integer(fields[1], fields[0]), integer(fields[2], fields[0])};
            for (int axis = 0; axis < 2; axis++) {
                if (point[axis] > RAW_MAX[axis]) {
                    throw new IOException("control " + fields[0] + " is off the HID axes");
                }
            }
            if (raw.put(fields[0], point) != null) throw new IOException("control " + fields[0] + " is named twice");
        }
        if (!SCHEMA.equals(schema)) throw new IOException(FILE + " is not " + SCHEMA);
        if (profile == null || bound == null) throw new IOException(FILE + " does not name its profile");
        if (!bound.equals(profileSha256)) {
            throw new IOException(FILE + " was derived from another profile than the one beside it");
        }
        if (raw.isEmpty()) throw new IOException(FILE + " names no control");
        return new HidControls(profile, bound, raw);
    }

    /** Refuses a plan that uses a control this file does not name, naming each one. */
    public void requireAll(Collection<String> used) throws IOException {
        TreeSet<String> missing = new TreeSet<>();
        for (String control : used) if (!raw.containsKey(control)) missing.add(control);
        if (!missing.isEmpty()) {
            throw new IOException("the plan uses " + String.join(", ", missing)
                    + ", which " + FILE + " for profile " + profileId + " does not name");
        }
    }

    /** A control's raw HID coordinates. */
    public int[] raw(String control) throws IOException {
        int[] point = raw.get(control);
        if (point == null) throw new IOException("control " + control + " is not in " + FILE);
        return point;
    }

    /**
     * A plan's control token as the file names it: a camera spelled {@code camN}
     * is {@code cam:N}, every other name is itself. Until 2026-09-30 the runner
     * rewrote any token starting with "cam", so {@code cameraFeedLight} became
     * {@code cam:eraFeedLight} and every Minus Toys plan was refused.
     */
    public static String planControl(String token) throws IOException {
        if (token == null || !token.matches("[A-Za-z][A-Za-z0-9:]*")) {
            throw new IOException("unknown plan control: " + token);
        }
        return token.matches("cam\\d+") ? "cam:" + token.substring(3) : token;
    }

    /** One contact record: flags, raw X low and high byte, raw Y low and high byte. */
    public static String contact(int flags, int[] point) {
        return "[" + flags + "," + (point[0] & 255) + "," + ((point[0] >> 8) & 255)
                + "," + (point[1] & 255) + "," + ((point[1] >> 8) & 255) + "]";
    }

    /**
     * The second finger's record in a two-contact report: contact id 1 (flag
     * bit 2), down 7 and up 4, as {@code packages/play/src/campaign/hid-schedule.ts}
     * sends it. The first finger is {@link #contact} with 3 and 0.
     */
    public static String secondContact(boolean down, int[] point) {
        return contact(down ? 7 : 4, point);
    }

    /** Lowercase hex sha256 of some bytes, as the host names a profile. */
    public static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest) hex.append(String.format("%02x", value & 255));
            return hex.toString();
        } catch (NoSuchAlgorithmException missing) {
            throw new IllegalStateException("SHA-256 is unavailable", missing);
        }
    }

    public static String utf8(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static int integer(String value, String control) throws IOException {
        try {
            int result = Integer.parseInt(value);
            if (result < 0) throw new NumberFormatException("negative");
            return result;
        } catch (NumberFormatException error) {
            throw new IOException("control " + control + " has an invalid coordinate", error);
        }
    }
}
