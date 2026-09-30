package com.ppvaz.fnafcompanion;

/**
 * The games the Companion may be pointed at, by package.
 *
 * <p>A target is always named explicitly -- by the host's setup, the TARGET
 * verb, or the operator's picker -- and nothing here launches a default game.
 * The target decides two things on the phone: which label the status reports,
 * and whether the FNaF 2 legacy readers run at all ({@link Fnaf2Legacy}, retail
 * FNaF 2 only). Everything else is game-agnostic.</p>
 *
 * <p>Mirrors {@code packages/play/profiles/fnaf2/moto-g56/companion-targets-v1.json};
 * {@code TargetsTest} holds the two to each other. Pure Java.</p>
 */
public final class Targets {
    public static final String SCHEMA = "companion-targets-v1";

    /** One known target. */
    public static final class Target {
        public final String game;
        public final String packageName;
        public final String label;
        public final boolean rebuild;
        /** The on-device reader set this target enables, or null. */
        public final String legacyReaders;

        Target(String game, String packageName, String label, boolean rebuild,
                String legacyReaders) {
            this.game = game;
            this.packageName = packageName;
            this.label = label;
            this.rebuild = rebuild;
            this.legacyReaders = legacyReaders;
        }

        public boolean fnaf2Legacy() {
            return "fnaf2".equals(legacyReaders);
        }
    }

    private static final Target[] KNOWN = {
            new Target("fnaf1", "com.scottgames.fivenightsatfreddys", "FNaF 1", false, null),
            new Target("fnaf2", "com.scottgames.fnaf2", "FNaF 2", false, "fnaf2"),
            new Target("fnaf3", "com.scottgames.fnaf3", "FNaF 3", false, null),
            new Target("fnaf4", "com.scottgames.fnaf4", "FNaF 4", false, null),
            new Target("fnaf1-rebuild", "org.fnaf1rebuild.play", "FNaF 1 rebuild", true, null),
            new Target("fnaf2-rebuild", "org.fnaf2rebuild.play", "FNaF 2 rebuild", true, null),
            new Target("fnaf3-rebuild", "org.fnaf3rebuild.play", "FNaF 3 rebuild", true, null),
            new Target("fnaf4-rebuild", "org.fnaf4rebuild.play", "FNaF 4 rebuild", true, null),
    };

    private Targets() {
    }

    public static int size() {
        return KNOWN.length;
    }

    public static Target at(int index) {
        return KNOWN[index];
    }

    /** The known target with this package, or null. */
    public static Target byPackage(String packageName) {
        if (packageName == null) return null;
        for (Target target : KNOWN) {
            if (target.packageName.equals(packageName)) return target;
        }
        return null;
    }

    /** The known target with this game key, or null. */
    public static Target byGame(String game) {
        if (game == null) return null;
        for (Target target : KNOWN) {
            if (target.game.equals(game)) return target;
        }
        return null;
    }

    /** A package or a game key, resolved to a known target, or null. */
    public static Target resolve(String name) {
        Target target = byPackage(name);
        return target != null ? target : byGame(name);
    }
}
