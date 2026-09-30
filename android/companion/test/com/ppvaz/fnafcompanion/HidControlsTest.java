package com.ppvaz.fnafcompanion;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;

/**
 * Holds HidControls to a committed route bundle: it reads the controls the host
 * derived from the profile beside them, refuses a file bound to another profile
 * and a plan control the file does not name, and encodes a contact's bytes.
 * packages/play/bin/phone/test-screen-map.mjs holds the file itself to the
 * host transport's transform.
 */
public final class HidControlsTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    private interface Body {
        void run() throws IOException;
    }

    private static void refused(String what, String expected, Body body) {
        try {
            body.run();
            check(what + " is refused", false);
        } catch (IOException error) {
            check(what + " names why (" + error.getMessage() + ")", error.getMessage().contains(expected));
        }
    }

    public static void main(String[] args) throws IOException {
        Path bundle = Paths.get(System.getProperty("hid.bundle",
                "android/companion/assets/runners/generated/minus-toys"));
        byte[] profile = Files.readAllBytes(bundle.resolve("profile.json"));
        String text = HidControls.utf8(Files.readAllBytes(bundle.resolve(HidControls.FILE)));
        String sha = HidControls.sha256Hex(profile);

        HidControls controls = HidControls.parse(text, sha);
        check("the file names the profile beside it", "hid-mediaprojection".equals(controls.profileId)
                && sha.equals(controls.profileSha256));
        // The mask at (600, 995) on the 2400x1080 landscape screen, through the
        // transport's transform: ((1080 - 995) * 20 / 9, 600 * 9 / 20).
        check("the mask's raw point", Arrays.equals(controls.raw("mask"), new int[] {188, 270}));
        check("a pressed contact's bytes", "[3,188,0,14,1]".equals(HidControls.contact(3, controls.raw("mask"))));
        check("a released contact's bytes", "[0,188,0,14,1]".equals(HidControls.contact(0, controls.raw("mask"))));
        controls.requireAll(Arrays.asList("mask", "monitor", "hallLight", "cam:9", "cam:11"));
        refused("a plan control the file does not name", "cam:12, sofa",
                () -> controls.requireAll(Arrays.asList("mask", "sofa", "cam:12")));
        refused("an unknown control", "not in", () -> controls.raw("sofa"));

        refused("a file bound to another profile", "another profile",
                () -> HidControls.parse(text, sha.replace(sha.charAt(0), sha.charAt(0) == 'a' ? 'b' : 'a')));
        refused("another schema", "is not", () -> HidControls.parse(text.replace("hid-controls-v1", "hid-controls-v0"), sha));
        refused("a file with no profile header", "does not name its profile",
                () -> HidControls.parse(text.replaceAll("(?m)^#profile .*\\n", ""), sha));
        refused("an unknown header", "unknown header", () -> HidControls.parse("#geometry 2400x1080\n" + text, sha));
        refused("a control off the HID axes", "off the HID axes",
                () -> HidControls.parse(text.replaceFirst("(?m)^mask \\d+ ", "mask 2400 "), sha));
        refused("a control named twice", "named twice", () -> HidControls.parse(text + "mask 1 1\n", sha));
        refused("a malformed control line", "malformed", () -> HidControls.parse(text + "mask 1\n", sha));
        refused("a missing file", "missing", () -> HidControls.parse(null, sha));

        check("a camera spelled camN is cam:N", "cam:11".equals(HidControls.planControl("cam11")));
        check("cam:N stays", "cam:9".equals(HidControls.planControl("cam:9")));
        check("the camera feed light is not a camera",
                "cameraFeedLight".equals(HidControls.planControl("cameraFeedLight")));
        check("other controls are themselves", "mask".equals(HidControls.planControl("mask")));
        refused("a token that is not a control name", "unknown plan control", () -> HidControls.planControl("cam 9"));

        if (failures > 0) {
            System.out.println("HidControlsTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("hid controls: the runner reads the bundle's controls bound to its profile, refuses "
                + "another profile, an unknown or unnamed control and a point off the axes, encodes contacts, "
                + "and spells camN as cam:N without touching cameraFeedLight");
    }
}
