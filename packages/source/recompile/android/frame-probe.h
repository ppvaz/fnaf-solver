// Bounded replay configuration for a separately packaged research build.
// Inputs are private files; this instrument does not measure external delivery.
#ifndef FNAF2_FRAME_PROBE_H
#define FNAF2_FRAME_PROBE_H

#ifdef CHOWDREN_IS_ANDROID
#ifdef NDEBUG
#error Frame probe requires build-lib.sh --frame-probe (object names enabled)
#endif
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace {

static void frame_probe_fail(const char * message)
{
    std::fprintf(stderr, "frame-probe: %s\n", message);
    std::exit(3);
}

static int frame_probe_number(const char * text, int maximum)
{
    if (!*text) return -1;
    int value = 0;
    for (const char * digit = text; *digit; ++digit) {
        if (*digit < '0' || *digit > '9') return -1;
        const int next = *digit - '0';
        if (value > (maximum - next) / 10) return -1;
        value = value * 10 + next;
        if (value > maximum) return -1;
    }
    return value;
}

static void frame_probe_env(const char * name, const std::string & value)
{
    if (setenv(name, value.c_str(), 1) != 0)
        frame_probe_fail("cannot configure replay environment");
}

static void frame_probe_init(const char * directory)
{
    if (directory == NULL || !*directory)
        frame_probe_fail("private storage unavailable");
    const std::string root = std::string(directory) + "/";
    FILE * config = std::fopen((root + "frame-probe.enabled").c_str(), "r");
    if (config == NULL) {
        if (errno == ENOENT) return; // No enable file: ordinary research play.
        frame_probe_fail("cannot read private configuration");
    }
    char line[96], schema[32], seed_text[7], updates_text[6], trailing;
    const bool read = std::fgets(line, sizeof(line), config) != NULL;
    const bool complete = std::fgetc(config) == EOF && !std::ferror(config);
    std::fclose(config);
    if (!read || !complete ||
        std::sscanf(line, "%31s %6s %5s %c", schema, seed_text, updates_text, &trailing) != 3 ||
        std::strcmp(schema, "frame-probe-v1") != 0)
        frame_probe_fail("invalid configuration; expected frame-probe-v1 SEED UPDATES");
    const int seed = frame_probe_number(seed_text, 65535);
    const int updates = frame_probe_number(updates_text, 6000);
    if (seed < 0 || updates < 1)
        frame_probe_fail("seed or update bound outside permitted range");

    frame_probe_env("CHOWDREN_HARNESS", "1");
    frame_probe_env("CHOWDREN_REALTIME", "1");
    frame_probe_env("CHOWDREN_SEED", std::to_string(seed));
    frame_probe_env("CHOWDREN_SEED_FRAME", "3");
    frame_probe_env("CHOWDREN_INPUT", root + "frame-probe.input");
    frame_probe_env("CHOWDREN_TRACE", root + "frame-probe.trace");
    frame_probe_env("CHOWDREN_FRAME_TIMES", root + "frame-probe.clock");
    frame_probe_env("CHOWDREN_FRAME_TIMES_FRAME", "3");
    frame_probe_env("CHOWDREN_STOP_FRAME", "3");
    frame_probe_env("CHOWDREN_MAX_TICKS", std::to_string(updates));
    frame_probe_env("CHOWDREN_MAX_TOTAL_TICKS", "9000");
    frame_probe_env("CHOWDREN_WATCH_COUNTER",
        "viewing,being attacked by,in danger,cust_freddy AI,cust_bonie AI,"
        "cust_chica AI,cust_foxy AI,cust_BB AI,cust_toy freddy AI,"
        "cust_toy bonnie AI,cust_toy chica AI,cust_mangle AI,cust_golden freddy AI");
}

} // namespace
#endif // CHOWDREN_IS_ANDROID
#endif // FNAF2_FRAME_PROBE_H
