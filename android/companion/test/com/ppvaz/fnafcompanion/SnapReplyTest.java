package com.ppvaz.fnafcompanion;

import static com.ppvaz.fnafcompanion.Check.check;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

/** The SNAP reply against companion-snap-v1.txt, the line the host's parseSnapReply reads back. */
public final class SnapReplyTest {
    private SnapReplyTest() {
    }

    public static void main(String[] args) throws IOException {
        List<String> vector = Files.readAllLines(Paths.get(System.getProperty(
                "snap.vector", "packages/play/test/testdata/companion-snap-v1.txt")), StandardCharsets.UTF_8);
        String label = null;
        Long imageNs = null;
        Long snapshotNs = null;
        String expected = null;
        for (String row : vector) {
            if (row.startsWith("label: ")) label = row.substring(7);
            else if (row.startsWith("imageNs: ")) imageNs = Long.parseLong(row.substring(9));
            else if (row.startsWith("snapshotNs: ")) snapshotNs = Long.parseLong(row.substring(12));
            else if (row.startsWith("line: ")) expected = row.substring(6);
        }
        check("the vector names a label, both clocks and a line",
                label != null && imageNs != null && snapshotNs != null && expected != null);
        String reply = SnapReply.ok(label, imageNs, snapshotNs);
        check("the reply is the vector line\n  expected " + expected + "\n  actual   " + reply, reply.equals(expected));
        check("the path names the label's PNG under files/frames",
                SnapReply.path(label).equals("files/frames/" + label + ".png"));
        Check.done("SnapReplyTest: all checks passed");
    }
}
