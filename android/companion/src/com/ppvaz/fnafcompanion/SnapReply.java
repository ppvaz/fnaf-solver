package com.ppvaz.fnafcompanion;

/**
 * The OK reply to {@code SNAP <token> <label>}: where the frame was written and
 * the two clocks that place it. Held from both sides by
 * packages/play/test/testdata/companion-snap-v1.txt (SnapReplyTest.java here,
 * companion-snap.test.ts on the host, whose parseSnapReply reads it back).
 */
final class SnapReply {
    private SnapReply() {
    }

    /** The app-relative path a SNAP of {@code label} writes, and the reply names. */
    static String path(String label) {
        return "files/frames/" + label + ".png";
    }

    static String ok(String label, long imageNs, long snapshotNs) {
        return "OK path=" + path(label) + " imageNs=" + imageNs + " snapshotNs=" + snapshotNs;
    }
}
