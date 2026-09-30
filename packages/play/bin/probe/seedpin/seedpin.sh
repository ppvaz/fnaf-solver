#!/system/bin/sh
# Device-side seed pin for FNaF 2 on Android. Runs ON THE PHONE (adb push, then adb shell sh).
#
# The office seed is (short) System.currentTimeMillis() at CRun.allocRunHeader, read at the end of
# the office frame's load. That load's length varies by ~140 ms (the game's own "took" 1197-1344 ms,
# 2026-09-18), which no tap timing can remove. So this controller acts at the seed moment itself:
# when the phone's own log shows the office frame loading, it has the Java pinner (pinner.dex, built
# by build.sh) hold the wall clock at a value congruent to TARGET (mod 65536), releases on the first
# line the runtime logs after the seed read, and the pinner restores real time.
#
# How close it can get is set by the platform: every set is settimeofday() plus a hardware RTC write
# (RTC_SET_TIME) under the time service's lock, ~6.5 ms each and serialised, so the clock re-sets
# about every 6.5 ms and the seed lands in [value, value + ~7) -- never a single chosen millisecond.
# Pin at the LOW end of a window whose values are wanted (two held nights at 24850/24851: ~2 in 7).
#
#   sh seedpin.sh game  TARGET [LEAD_MS] [EXPECT_MS] [OFFSET_MS] [WAIT_S] [MAXPIN_MS]
#   sh seedpin.sh bench HOLD_MS [LOOPS] [CAP] [OFFSET_MS]
# game:  wait for 'loading frame #:4', pin from LEAD_MS after it, release on the post-seed line.
# bench: no game; the older shell-loop pin (`cmd alarm set-time`, one process per set). Pin at
#        now+100 ms for HOLD_MS while logging SEEDPIN probe lines, then restore; the probes'
#        logcat timestamps are the pinned clock's actual readings.
# OFFSET_MS pins that much below the congruent value, centring the seed's read-after-set drift.
#
# ALL epoch arithmetic is done in awk: this shell's $(( )) is 32-bit, and on 2026-09-18 the first
# bench computed a pin value of -1304041761 from a 1.79e12 ms epoch. (The alarm service refused it;
# the clock never moved.) Uptime in ms is also past 1.7e9 and overflows at 24.8 days.
#
# Safety: each set-time loop stops after CAP iterations (about CAP x 34 ms) whatever happens; the
# STOP file ends them early; restore() runs once on any exit and puts real time back; a pin is
# refused if it would move the clock more than MAXJUMP_MS from where it would naturally read.
MODE=${1:?mode game|bench}
DIR=/data/local/tmp/seedpin; mkdir -p $DIR; STOP=$DIR/stop; LOG=$DIR/log; PINNED=$DIR/pinned; DONE=$DIR/restored
rm -f $STOP $PINNED $DONE $DIR/fifo; : > $LOG
MAXJUMP_MS=400
note() { echo "$(cut -d' ' -f1 /proc/uptime) $*" >> $LOG; }
up_ms() { awk '{printf "%.0f", $1*1000}' /proc/uptime; }
add() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.0f", a+b}'; }       # epoch-safe a+b
sub() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.0f", a-b}'; }       # epoch-safe a-b
low16() { awk -v a="$1" 'BEGIN{printf "%d", a % 65536}'; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a>b)}'; }                # a > b
wall_ms() { date +%s%3N; }
WALL0=$(wall_ms); UP0=$(up_ms)
PIN_PIDS=""; LOGCAT_PID=""; WATCHDOG_PID=""; PINNER_PID=""
echo $$ > $DIR/pid                    # the host stops this controller by this PID, never by pattern
restore() {
  [ -e $DONE ] && return; touch $DONE $STOP
  [ -n "$PIN_PIDS" ] && wait $PIN_PIDS 2>/dev/null
  if [ -n "$PINNER_PID" ]; then wait $PINNER_PID 2>/dev/null; note "pinner: $(cat $DIR/pinner.out 2>/dev/null | tr '\n' ' ')"; rm -f $PINNED; fi
  [ -n "$LOGCAT_PID" ] && kill $LOGCAT_PID 2>/dev/null
  [ -n "$WATCHDOG_PID" ] && kill $WATCHDOG_PID 2>/dev/null
  rm -f $DIR/pid
  if [ -e $PINNED ]; then
    real=$(add "$WALL0" "$(sub "$(up_ms)" "$UP0")"); real=$(add "$real" "${RESTORE_LEAD_MS:-40}")   # the set lands ~35 ms after it is computed
    cmd alarm set-time $real >/dev/null 2>&1
    note "restore real=$real wall_after=$(wall_ms)"
  fi
  note "exit"
}
trap restore EXIT
trap 'restore; exit 130' INT TERM HUP
pin() {  # $1 = value to hold
  touch $PINNED; note "pin start value=$1 low16=$(low16 "$1") loops=$LOOPS cap=$CAP"
  i=0
  while [ $i -lt $LOOPS ]; do
    ( n=0; while [ $n -lt $CAP ] && [ ! -e $STOP ]; do cmd alarm set-time $1 >/dev/null 2>&1; n=$((n+1)); done ) &
    PIN_PIDS="$PIN_PIDS $!"; i=$((i+1))
  done
}
congruent_near() {  # value congruent to $2 (mod 65536) nearest to $1
  awk -v x="$1" -v t="$2" 'BEGIN { b = x - (x % 65536) + t; best = b; for (k = -1; k <= 1; k++) { c = b + k*65536; if ((c-x)^2 < (best-x)^2) best = c }; printf "%.0f", best }'
}

if [ "$MODE" = bench ]; then
  HOLD=${2:-600}; LOOPS=${3:-8}; CAP=${4:-40}; OFFSET=${5:-0}
  value=$(sub "$(add "$(wall_ms)" 100)" "$OFFSET")
  pin $value
  k=0; while [ $k -lt 40 ] && [ ! -e $STOP ]; do log -t SEEDPIN "probe $k value=$value"; k=$((k+1)); done
  sleep $(awk -v l=$HOLD 'BEGIN{printf "%.3f", l/1000}')
  note "bench done probes=$k"; exit 0
fi

TARGET=${2:?target low16}; LEAD=${3:-1050}; EXPECT=${4:-1280}; OFFSET=${5:-0}; WAIT_S=${6:-240}; MAXPIN_MS=${7:-1500}
# The pin itself is the Java pinner (/data/local/tmp/pinner.dex): one process calling the alarm
# service directly, with a 3 s hard cap, an exact restore from back-to-back wall/monotonic reads,
# and a shutdown hook. The service costs ~7 ms per set and serialises (bench, 2026-09-18), so the
# seed lands in [value, value + ~7): pin at the LOW end of a window of held seeds.
( sleep $WAIT_S; kill -TERM $$ 2>/dev/null ) &
WATCHDOG_PID=$!
: > $DIR/stream
logcat -v epoch -T 1 -s MMFRuntime:V > $DIR/stream 2>/dev/null &
LOGCAT_PID=$!
line_ms() { echo "$1" | awk '{ split($1, a, "."); printf "%s%s", a[1], substr(a[2] "000", 1, 3) }'; }
# 1. the office frame starts loading; only a line stamped after this controller started counts.
#    Polled every 50 ms so the poll does not compete with the game through the menu wait.
load=""; loadline=0
while [ -z "$load" ]; do
  hit=$(awk -v w="$WALL0" '/loading frame #:4/ { split($1, a, "."); ms = a[1] substr(a[2] "000", 1, 3); if (ms + 0 >= w + 0) { print NR, ms; exit } }' $DIR/stream)
  if [ -n "$hit" ]; then loadline=${hit% *}; load=${hit#* }; break; fi
  sleep 0.05
done
natural=$(add "$load" "$EXPECT"); value=$(sub "$(congruent_near "$natural" "$TARGET")" "$OFFSET")
jump=$(sub "$value" "$natural"); startAt=$(add "$load" "$LEAD")
note "office load stamped $load (line $loadline); natural seed ~$natural; pin value $value low16 $(low16 "$value") (jump $jump ms) from $startAt"
if [ ${jump#-} -gt $MAXJUMP_MS ]; then note "refuse: the coarse aim is $jump ms off"; exit 0; fi
# 2. the pinner starts now (ART takes a few hundred ms to come up) and holds from startAt
rm -f $STOP
CLASSPATH=/data/local/tmp/pinner.dex app_process / Pinner "$value" "$startAt" "$MAXPIN_MS" $STOP 1 > $DIR/pinner.out 2>&1 &
PINNER_PID=$!; touch $PINNED
# 3. release on the first line the runtime logs after the seed read, polled every 5 ms
until awk -v n=$loadline 'NR > n && (/Created extension:/ || /iPhoneOptions are/) { found = 1; exit } END { exit !found }' $DIR/stream; do
  kill -0 $PINNER_PID 2>/dev/null || { note "pinner ended before the post-seed line"; break; }
  sleep 0.005
done
touch $STOP
post=$(awk -v n=$loadline 'NR > n && (/Created extension:/ || /iPhoneOptions are/) { print; exit }' $DIR/stream)
note "release; post-seed line stamped $(line_ms "$post") (low16 $(low16 "$(line_ms "$post")"))"
exit 0
