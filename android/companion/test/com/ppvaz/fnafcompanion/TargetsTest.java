package com.ppvaz.fnafcompanion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Holds Targets.java to tools/device/models/companion-targets-v1.json, entry for entry. */
public final class TargetsTest {
    private static int failures;

    private static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    public static void main(String[] args) throws IOException {
        String model = new String(Files.readAllBytes(Paths.get(System.getProperty(
                "targets.model", "tools/device/models/companion-targets-v1.json"))),
                StandardCharsets.UTF_8);
        check("model schema", model.contains("\"schema\": \"" + Targets.SCHEMA + "\""));
        Matcher entry = Pattern.compile("\\{\\s*\"game\": \"([^\"]+)\",\\s*\"package\": \"([^\"]+)\","
                + "\\s*\"label\": \"([^\"]+)\",\\s*\"rebuild\": (true|false),"
                + "\\s*\"legacyReaders\": (null|\"[^\"]+\")").matcher(model);
        List<String[]> declared = new ArrayList<>();
        while (entry.find()) {
            declared.add(new String[] {entry.group(1), entry.group(2), entry.group(3),
                    entry.group(4), entry.group(5).replace("\"", "")});
        }
        check("the model and the class list the same number of targets",
                declared.size() == Targets.size());
        for (int i = 0; i < Math.min(declared.size(), Targets.size()); i++) {
            String[] row = declared.get(i);
            Targets.Target target = Targets.at(i);
            check("target " + i + " game", target.game.equals(row[0]));
            check("target " + i + " package", target.packageName.equals(row[1]));
            check("target " + i + " label", target.label.equals(row[2]));
            check("target " + i + " rebuild", target.rebuild == Boolean.parseBoolean(row[3]));
            check("target " + i + " legacy readers",
                    ("null".equals(row[4]) ? null : row[4]) == null
                            ? target.legacyReaders == null : row[4].equals(target.legacyReaders));
        }
        check("only retail FNaF 2 enables the legacy readers",
                Targets.byPackage("com.scottgames.fnaf2").fnaf2Legacy()
                        && !Targets.byPackage("org.fnaf2rebuild.play").fnaf2Legacy()
                        && !Targets.byPackage("com.scottgames.fnaf4").fnaf2Legacy());
        check("a game key resolves", Targets.resolve("fnaf4").packageName.equals("com.scottgames.fnaf4"));
        check("a package resolves", Targets.resolve("com.scottgames.fnaf3").game.equals("fnaf3"));
        check("an unknown name does not resolve", Targets.resolve("com.example.other") == null
                && Targets.resolve(null) == null);

        if (failures > 0) {
            System.out.println("TargetsTest: " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("TargetsTest: Targets.java matches companion-targets-v1.json");
    }
}
