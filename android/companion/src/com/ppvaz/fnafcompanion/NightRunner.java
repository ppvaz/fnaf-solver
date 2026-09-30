package com.ppvaz.fnafcompanion;

import android.content.res.AssetManager;
import android.os.SystemClock;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/**
 * Device-local consumer for canonical strategy plans.
 *
 * <p>The APK consumes the finite plan vocabulary emitted by the host bundle
 * compiler. It does not recreate a strategy from knobs. Routes are selected
 * from {@link RunnerCatalog}, and the catalog must explicitly allow a route
 * before this class will open the HID stream. Visual arm/read and reactive
 * cycle adapters are intentionally fail-closed until they are qualified.</p>
 *
 * <p>It holds no device geometry. Every control it presses comes from the route
 * bundle's {@link HidControls#FILE}, which the host derives from the bundle's
 * device profile and binds to that profile's sha256; a plan that uses a control
 * the file does not name is refused before anything is sent. Until 2026-09-30
 * this class kept its own control map and 2400x1080 transform.</p>
 */
public final class NightRunner {
    private static final int HID_ID = 92;
    private static final int READY_DELAY_MS = 7_000;
    private static final int PORTION_UPDATE_MS = 5_000;
    private static final int DEFAULT_MASK_CONTACT_MS = 33;
    private static final String[] DESCRIPTOR = {
            "5", "13", "9", "4", "161", "1", "133", "1", "9", "34", "161", "0", "9", "85", "21", "0", "37", "2",
            "117", "8", "149", "1", "177", "2", "9", "84", "129", "2", "5", "13", "9", "34", "161", "2", "9",
            "66", "21", "0", "37", "1", "117", "1", "129", "2", "9", "50", "129", "2", "9", "81", "37", "63", "117", "6",
            "129", "2", "5", "1", "9", "48", "38", "95", "9", "117", "16", "129", "2", "9", "49", "38", "55",
            "4", "129", "2", "192", "5", "13", "9", "34", "161", "2", "9", "66", "21", "0", "37", "1", "117",
            "1", "129", "2", "9", "50", "129", "2", "9", "81", "37", "63", "117", "6", "129", "2", "5", "1", "9",
            "48", "38", "95", "9", "117", "16", "129", "2", "9", "49", "38", "55", "4", "129", "2", "192", "192",
            "192",
    };

    public interface ProgressListener {
        void onProgress(String text);
    }

    private static final class Action {
        final String cycle;
        final int atMs;
        final String kind;
        final String control;
        final int first;
        final int second;
        final int third;
        final int fourth;
        final String[] tokens;

        Action(String cycle, int atMs, String kind, String control,
                int first, int second, int third, int fourth, String[] tokens) {
            this.cycle = cycle;
            this.atMs = atMs;
            this.kind = kind;
            this.control = control;
            this.first = first;
            this.second = second;
            this.third = third;
            this.fourth = fourth;
            this.tokens = tokens;
        }
    }

    private static final class Plan {
        String policy;
        int night = -1;
        int periodMs = -1;
        int loopStartMs = -1;
        int stopAtMs = -1;
        int observeUntilMs = -1;
        int idleUntilMs = 0;
        boolean armVerify;
        boolean visualRead;
        final Set<String> cycles = new HashSet<>();
        final List<Action> actions = new ArrayList<>();
    }

    private static final class ScheduledAction {
        final int atMs;
        final Action action;

        ScheduledAction(int atMs, Action action) {
            this.atMs = atMs;
            this.action = action;
        }
    }

    private final AssetManager assets;
    private final RunnerCatalog.Route route;
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private HidControls controls;

    public NightRunner(AssetManager assets, RunnerCatalog.Route route) {
        this.assets = assets;
        this.route = route;
    }

    public void stop() {
        cancelled.set(true);
    }

    public void execute(TermuxBridge bridge, BooleanSupplier nightStillVisible,
            ProgressListener listener) throws IOException {
        if (route == null || !route.isRunnable()) {
            throw new IOException("selected route is disabled: "
                    + (route == null ? "no route selected" : route.disabledReason()));
        }
        if (bridge == null || !bridge.isConnected()) {
            throw new IOException("Termux bridge is not connected");
        }
        if (nightStillVisible != null && !nightStillVisible.getAsBoolean()) {
            throw new IOException("capture is not observing FNAF2_NIGHT");
        }
        cancelled.set(false);
        Plan plan = readPlan();
        if (plan.armVerify && !route.adaptersReady) {
            throw new IOException("route requires a qualified visual arm adapter");
        }
        if (plan.visualRead) {
            throw new IOException("route requires a qualified visual read adapter");
        }
        List<String> stream = compile(plan);
        if (listener != null) {
            listener.onProgress("Sending Night " + plan.night + " "
                    + plan.policy + " route...");
        }
        for (String line : stream) {
            if (cancelled.get()) throw new IOException("runner stopped");
            bridge.send(line);
        }

        final long started = SystemClock.elapsedRealtime();
        final long total = READY_DELAY_MS + plan.observeUntilMs + 1_000L;
        long nextUpdate = started;
        while (!cancelled.get()) {
            long elapsed = SystemClock.elapsedRealtime() - started;
            if (elapsed >= total) break;
            if (nightStillVisible != null && !nightStillVisible.getAsBoolean()) {
                bridge.sendRelease();
                throw new IOException("capture left FNAF2_NIGHT; route stopped");
            }
            if (listener != null && SystemClock.elapsedRealtime() >= nextUpdate) {
                long percent = Math.min(99L, elapsed * 100L / total);
                listener.onProgress("Night " + plan.night + " route active: " + percent + "%");
                nextUpdate += PORTION_UPDATE_MS;
            }
            try {
                Thread.sleep(Math.min(250L, Math.max(25L, total - elapsed)));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("runner interrupted", interrupted);
            }
        }
        if (cancelled.get()) throw new IOException("runner stopped");
        if (listener != null) {
            listener.onProgress("Night " + plan.night
                    + " route stream complete; outcome requires visual grading.");
        }
    }

    private Plan readPlan() throws IOException {
        if (assets == null || route.planAsset == null || route.planAsset.contains("..")
                || !route.planAsset.startsWith("runners/")) {
            throw new IOException("route plan asset is unsafe");
        }
        String bundle = route.planAsset.substring(0, route.planAsset.lastIndexOf('/'));
        controls = HidControls.parse(HidControls.utf8(assetBytes(bundle + "/" + HidControls.FILE)),
                HidControls.sha256Hex(assetBytes(bundle + "/profile.json")));
        Plan plan = new Plan();
        try (InputStream input = assets.open(route.planAsset);
                BufferedReader reader = new BufferedReader(new InputStreamReader(
                        input, StandardCharsets.US_ASCII))) {
            String cycle = "";
            String raw;
            while ((raw = reader.readLine()) != null) {
                String line = raw.trim();
                if (line.isEmpty()) continue;
                if (line.startsWith("#")) {
                    String header = line.substring(1).trim();
                    if (header.isEmpty()) throw new IOException("plan header is empty");
                    String[] fields = header.split("\\s+");
                    switch (fields[0]) {
                        case "policy":
                            plan.policy = requiredField(fields, 1, "policy");
                            break;
                        case "night":
                            plan.night = integer(fields, 1, "night");
                            break;
                        case "period":
                            plan.periodMs = integer(fields, 1, "period");
                            break;
                        case "loop-start":
                            plan.loopStartMs = integer(fields, 1, "loop-start");
                            break;
                        case "stop-at":
                            plan.stopAtMs = integer(fields, 1, "stop-at");
                            break;
                        case "observe-until":
                            plan.observeUntilMs = integer(fields, 1, "observe-until");
                            break;
                        case "idle-until":
                            plan.idleUntilMs = integer(fields, 1, "idle-until");
                            break;
                        case "arm-verify":
                            plan.armVerify = fields.length > 1 && "1".equals(fields[1]);
                            break;
                        case "cycle":
                            cycle = requiredField(fields, 1, "cycle");
                            if (!isCycle(cycle)) throw new IOException("unsupported plan cycle: " + cycle);
                            plan.cycles.add(cycle);
                            break;
                        default:
                            // Arm camera metadata, phase offsets, and other
                            // identity headers are intentionally not guessed.
                            break;
                    }
                    continue;
                }
                if (cycle.isEmpty()) throw new IOException("plan action has no cycle");
                parseAction(plan, cycle, line.split("\\s+"));
            }
        }
        if (plan.night < 1 || plan.night > 7 || plan.periodMs <= 0
                || plan.loopStartMs < 0 || plan.stopAtMs <= plan.loopStartMs
                || plan.observeUntilMs < plan.stopAtMs || plan.actions.isEmpty()
                || !plan.cycles.contains("opening")) {
            throw new IOException("plan identity or timing is invalid");
        }
        boolean hasLoop = false;
        for (String name : plan.cycles) {
            if (!"opening".equals(name) && !"finish".equals(name)) {
                hasLoop = true;
                break;
            }
        }
        if (!hasLoop) throw new IOException("plan has no repeatable cycle");
        if (route.night != plan.night || !route.strategy.equals(plan.policy)) {
            throw new IOException("plan identity does not match the selected route");
        }
        controls.requireAll(controlsUsed(plan));
        return plan;
    }

    private byte[] assetBytes(String name) throws IOException {
        try (InputStream input = assets.open(name)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int read; (read = input.read(chunk)) > 0; ) bytes.write(chunk, 0, read);
            return bytes.toByteArray();
        }
    }

    /** Every control the plan's actions press, as {@link #addAction} presses them. */
    private static Set<String> controlsUsed(Plan plan) {
        Set<String> used = new TreeSet<>();
        for (Action action : plan.actions) {
            switch (action.kind) {
                case "tap":
                case "hold":
                    used.add(action.control);
                    break;
                case "hall":
                    used.add("hallLight");
                    break;
                case "hallvent":
                    used.add("hallLight");
                    used.add("rightVentLight");
                    break;
                case "hallraise":
                    used.add("hallLight");
                    used.add("monitor");
                    break;
                case "maskraise":
                    used.add("mask");
                    used.add("monitor");
                    if ("hall".equals(action.control)) used.add("hallLight");
                    break;
                case "camdrop":
                    used.add("cameraFeedLight");
                    used.add("monitor");
                    break;
                case "sweep":
                    used.add("cameraFeedLight");
                    for (String camera : action.tokens) {
                        int split = camera.indexOf(':', 4);
                        used.add(split > 0 ? camera.substring(0, split) : camera);
                    }
                    break;
                case "read":
                    used.add(action.control);
                    if (action.fourth > 0) used.add("hallLight");
                    break;
                default:
                    break;
            }
        }
        return used;
    }

    private static void parseAction(Plan plan, String cycle, String[] fields)
            throws IOException {
        if (fields.length < 3) throw new IOException("plan action is incomplete");
        int at = parseInt(fields[0], "action time");
        String kind = fields[1];
        if ("tap".equals(kind) || "hold".equals(kind)) {
            if (fields.length != 4) throw new IOException("plan contact shape is invalid");
            plan.actions.add(new Action(cycle, at, kind, normalizeControl(fields[2]),
                    parseInt(fields[3], "contact"), 0, 0, 0, null));
        } else if ("hall".equals(kind) || "hallvent".equals(kind)
                || "hallraise".equals(kind)) {
            if (fields.length != 3) throw new IOException("plan compound shape is invalid");
            plan.actions.add(new Action(cycle, at, kind, null,
                    parseInt(fields[2], "compound contact"), 0, 0, 0, null));
        } else if ("maskraise".equals(kind)) {
            if (fields.length != 5 || !("hall".equals(fields[3]) || "up".equals(fields[3]))) {
                throw new IOException("plan maskraise shape is invalid");
            }
            plan.actions.add(new Action(cycle, at, kind, fields[3],
                    parseInt(fields[2], "maskraise gap"),
                    parseInt(fields[4], "maskraise contact"), 0, 0, null));
        } else if ("camdrop".equals(kind)) {
            if (fields.length != 5) throw new IOException("plan camdrop shape is invalid");
            plan.actions.add(new Action(cycle, at, kind, "cameraFeedLight",
                    parseInt(fields[2], "camdrop lead"),
                    parseInt(fields[3], "camdrop contact"),
                    parseInt(fields[4], "camdrop tail"), 0, null));
        } else if ("sweep".equals(kind)) {
            if (fields.length != 5) throw new IOException("plan sweep shape is invalid");
            String[] cameras = fields[4].split(",");
            if (cameras.length < 2) throw new IOException("plan sweep needs two cameras");
            for (int index = 0; index < cameras.length; index++) {
                cameras[index] = normalizeCameraToken(cameras[index]);
            }
            plan.actions.add(new Action(cycle, at, kind, null,
                    parseInt(fields[2], "sweep spacing"),
                    parseInt(fields[3], "sweep contact"), 0, 0, cameras));
        } else if ("read".equals(kind)) {
            if (fields.length != 4 && fields.length != 6 && fields.length != 8) {
                throw new IOException("plan read shape is invalid");
            }
            if (fields.length >= 6 && fields.length < 6) {
                throw new IOException("plan read hall fields are incomplete");
            }
            int hallAt = fields.length >= 6 ? parseInt(fields[4], "read hall offset") : 0;
            int hallDuration = fields.length >= 6 ? parseInt(fields[5], "read hall contact") : 0;
            if (fields.length == 8 && !"bangage".equals(fields[6])) {
                throw new IOException("plan read conditional hall fields are invalid");
            }
            plan.visualRead = true;
            plan.actions.add(new Action(cycle, at, kind, "leftVentLight",
                    parseInt(fields[2], "read duration"),
                    parseInt(fields[3], "read gap"), hallAt, hallDuration, null));
        } else {
            throw new IOException("unsupported canonical plan action: " + kind);
        }
    }

    private List<String> compile(Plan plan) throws IOException {
        String loopCycle = null;
        for (String cycle : plan.cycles) {
            if ("opening".equals(cycle) || "finish".equals(cycle)) continue;
            if (loopCycle != null && !loopCycle.equals(cycle)) {
                throw new IOException("route requires a reactive cycle selector for "
                        + loopCycle + " and " + cycle);
            }
            loopCycle = cycle;
        }
        if (loopCycle == null) throw new IOException("route has no loop cycle");

        List<ScheduledAction> scheduled = new ArrayList<>();
        for (Action action : plan.actions) {
            if ("opening".equals(action.cycle) || "finish".equals(action.cycle)) {
                scheduled.add(new ScheduledAction(action.atMs, action));
            } else if (loopCycle.equals(action.cycle)) {
                for (int base = Math.max(plan.loopStartMs, plan.idleUntilMs);
                        base < plan.stopAtMs; base += plan.periodMs) {
                    int at = base + action.atMs;
                    if (at < plan.stopAtMs) scheduled.add(new ScheduledAction(at, action));
                }
            }
        }
        scheduled.sort(Comparator.comparingInt(item -> item.atMs));
        List<String> lines = new ArrayList<>();
        lines.add(registerLine());
        addDelay(lines, READY_DELAY_MS);
        int cursor = 0;
        for (ScheduledAction scheduledAction : scheduled) {
            if (scheduledAction.atMs < cursor) {
                throw new IOException("canonical HID actions overlap at "
                        + scheduledAction.atMs + " ms");
            }
            addDelay(lines, scheduledAction.atMs - cursor);
            int duration = addAction(lines, scheduledAction.action);
            cursor = scheduledAction.atMs + duration;
        }
        if (cursor > plan.observeUntilMs) {
            throw new IOException("route exceeds its observation envelope");
        }
        addDelay(lines, plan.observeUntilMs - cursor);
        return lines;
    }

    private int addAction(List<String> lines, Action action) throws IOException {
        switch (action.kind) {
            case "tap":
            case "hold":
                return addSingle(lines, action.control, action.first);
            case "hall":
                return addSingle(lines, "hallLight", action.first);
            case "hallvent":
                return addTwo(lines, "hallLight", "rightVentLight", action.first);
            case "hallraise":
                return addTwo(lines, "hallLight", "monitor", action.first);
            case "maskraise":
                return addMaskRaise(lines, action);
            case "camdrop":
                return addCameraDrop(lines, action);
            case "sweep":
                return addSweep(lines, action);
            case "read":
                throw new IOException("visual read adapter is not available for this route");
            default:
                throw new IOException("unsupported executable action: " + action.kind);
        }
    }

    private int addSingle(List<String> lines, String control, int duration)
            throws IOException {
        int[] target = point(control);
        lines.add(reportSingle(active(target)));
        addDelay(lines, duration);
        lines.add(reportSingle(released(target)));
        return duration;
    }

    private int addTwo(List<String> lines, String firstControl, String secondControl,
            int duration) throws IOException {
        int[] first = point(firstControl);
        int[] second = point(secondControl);
        lines.add(reportTwo(active(first), active(second)));
        addDelay(lines, duration);
        lines.add(reportTwo(released(first), released(second)));
        return duration;
    }

    private int addMaskRaise(List<String> lines, Action action) throws IOException {
        int[] mask = point("mask");
        lines.add(reportSingle(active(mask)));
        addDelay(lines, DEFAULT_MASK_CONTACT_MS);
        lines.add(reportSingle(released(mask)));
        addDelay(lines, action.first);
        if ("hall".equals(action.control)) {
            lines.add(reportTwo(active(point("hallLight")), active(point("monitor"))));
        } else {
            lines.add(reportSingle(active(point("monitor"))));
        }
        addDelay(lines, action.second);
        if ("hall".equals(action.control)) {
            lines.add(reportTwo(released(point("hallLight")), released(point("monitor"))));
        } else {
            lines.add(reportSingle(released(point("monitor"))));
        }
        return DEFAULT_MASK_CONTACT_MS + action.first + action.second;
    }

    private int addCameraDrop(List<String> lines, Action action) throws IOException {
        int[] light = point("cameraFeedLight");
        int[] monitor = point("monitor");
        lines.add(reportSingle(active(light)));
        addDelay(lines, action.first);
        lines.add(reportTwo(active(light), active(monitor)));
        addDelay(lines, action.second);
        lines.add(reportTwo(active(light), released(monitor)));
        addDelay(lines, action.third);
        lines.add(reportTwo(released(light), released(monitor)));
        return action.first + action.second + action.third;
    }

    private int addSweep(List<String> lines, Action action) throws IOException {
        int duration = 0;
        for (int index = 0; index < action.tokens.length; index++) {
            String camera = action.tokens[index];
            int lightMs = action.second;
            int split = camera.indexOf(':', 4);
            if (split > 0) {
                lightMs = parseInt(camera.substring(split + 1), "sweep camera contact");
                camera = camera.substring(0, split);
            }
            int[] selected = point(camera);
            lines.add(reportSingle(active(selected)));
            addDelay(lines, action.second);
            lines.add(reportSingle(released(selected)));
            int settle = action.second < 50 ? 17 : 0;
            addDelay(lines, settle);
            lines.add(reportSingle(active(point("cameraFeedLight"))));
            addDelay(lines, lightMs);
            lines.add(reportSingle(released(point("cameraFeedLight"))));
            duration += action.second + settle + lightMs;
            if (index + 1 < action.tokens.length) {
                int minimum = action.second + settle + lightMs;
                if (action.first < minimum) {
                    throw new IOException("sweep spacing is shorter than its HID contacts");
                }
                addDelay(lines, action.first - minimum);
                duration += action.first - minimum;
            }
        }
        return duration;
    }

    private static boolean isCycle(String cycle) {
        return "opening".equals(cycle) || "toys".equals(cycle)
                || "clear".equals(cycle) || "attack".equals(cycle)
                || "finish".equals(cycle);
    }

    private static String normalizeCameraToken(String token) throws IOException {
        String value = token.trim();
        if (value.startsWith("cam:") && value.length() > 4) {
            String number = value.substring(4);
            if (number.matches("\\d+(?::\\d+)?")) {
                String[] pieces = number.split(":", 2);
                String camera = normalizeControl("cam:" + pieces[0]);
                return pieces.length == 1 ? camera : camera + ":" + parseInt(pieces[1], "camera contact");
            }
        }
        if (value.startsWith("cam") && value.length() > 3) {
            return normalizeCameraToken("cam:" + value.substring(3));
        }
        if (value.matches("\\d+(?::\\d+)?")) {
            return normalizeCameraToken("cam:" + value);
        }
        throw new IOException("unknown sweep camera: " + token);
    }

    private static String normalizeControl(String control) throws IOException {
        return HidControls.planControl(control);
    }

    private int[] point(String control) throws IOException {
        return controls.raw(control);
    }

    private static String registerLine() {
        StringBuilder descriptor = new StringBuilder();
        descriptor.append('[');
        for (int index = 0; index < DESCRIPTOR.length; index++) {
            if (index > 0) descriptor.append(',');
            descriptor.append(DESCRIPTOR[index]);
        }
        descriptor.append(']');
        return "{\"id\":92,\"command\":\"register\",\"name\":\"FNAF Timed Touch\","
                + "\"vid\":6353,\"pid\":61959,\"bus\":\"usb\",\"descriptor\":"
                + descriptor + ",\"feature_reports\":[{\"id\":1,\"data\":[0]}]}";
    }

    private static String active(int[] point) {
        return HidControls.contact(3, point);
    }

    private static String released(int[] point) {
        return HidControls.contact(0, point);
    }

    private static String reportSingle(String contact) {
        String filler = contact.startsWith("[0,") ? "[4,0,0,0,0]" : "[0,0,0,0,0]";
        return "{\"id\":92,\"command\":\"report\",\"report\":[1,1,"
                + contact.substring(1, contact.length() - 1) + ","
                + filler.substring(1, filler.length() - 1) + "]}";
    }

    private static String reportTwo(String first, String second) {
        return "{\"id\":92,\"command\":\"report\",\"report\":[1,2,"
                + first.substring(1, first.length() - 1) + ","
                + second.substring(1, second.length() - 1) + "]}";
    }

    private static void addDelay(List<String> lines, int duration) {
        if (duration > 0) lines.add("{\"id\":92,\"command\":\"delay\",\"duration\":" + duration + "}");
    }

    private static String requiredField(String[] fields, int index, String label)
            throws IOException {
        if (fields.length <= index || fields[index].isEmpty()) {
            throw new IOException("plan " + label + " is missing");
        }
        return fields[index];
    }

    private static int integer(String[] fields, int index, String label) throws IOException {
        return parseInt(requiredField(fields, index, label), label);
    }

    private static int parseInt(String value, String label) throws IOException {
        try {
            int result = Integer.parseInt(value);
            if (result < 0) throw new NumberFormatException("negative");
            return result;
        } catch (NumberFormatException error) {
            throw new IOException("plan " + label + " is invalid", error);
        }
    }
}
