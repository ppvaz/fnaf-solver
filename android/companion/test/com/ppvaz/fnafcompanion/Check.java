package com.ppvaz.fnafcompanion;

/**
 * The host tests' one harness. Each test class runs in its own JVM
 * (android/companion/test.sh), so one failure count per run is that test's.
 */
final class Check {
    private static int failures;

    private Check() {
    }

    /** Records a failed check by name; the run continues so every failure is named. */
    static void check(String what, boolean condition) {
        if (!condition) {
            System.out.println("FAIL " + what);
            failures++;
        }
    }

    /** Exits 1 naming the failure count when any check failed, else prints the pass line. */
    static void done(String passLine) {
        if (failures > 0) {
            String test = StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE)
                    .getCallerClass().getSimpleName();
            System.out.println(test + ": " + failures + " failure(s)");
            System.exit(1);
        }
        System.out.println(passLine);
    }
}
