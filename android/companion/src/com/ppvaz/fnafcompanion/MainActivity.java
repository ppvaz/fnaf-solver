package com.ppvaz.fnafcompanion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.media.projection.MediaProjectionManager;
import android.media.projection.MediaProjectionConfig;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.content.res.Configuration;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.security.SecureRandom;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int REQUEST_MEDIA_PROJECTION = 1002;
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_STORE_URI = "market://details?id=com.termux";
    private static final String TERMUX_STORE_URL =
            "https://play.google.com/store/apps/details?id=com.termux";
    private static final int COLOR_BACKGROUND = Color.rgb(18, 10, 11);
    private static final int COLOR_PANEL = Color.rgb(31, 16, 18);
    private static final int COLOR_PANEL_BORDER = Color.rgb(119, 45, 39);
    private static final int COLOR_AMBER = Color.rgb(255, 176, 32);
    private static final int COLOR_TEXT = Color.rgb(255, 235, 216);
    private static final int COLOR_MUTED = Color.rgb(218, 188, 165);
    private static final int COLOR_BONNIE = Color.rgb(95, 57, 137);
    private static final int COLOR_BONNIE_PRESSED = Color.rgb(67, 38, 99);
    private static final int COLOR_BONNIE_STROKE = Color.rgb(176, 132, 214);
    private static final int COLOR_FREDDY = Color.rgb(111, 66, 43);
    private static final int COLOR_FREDDY_PRESSED = Color.rgb(77, 42, 28);
    private static final int COLOR_FREDDY_STROKE = Color.rgb(196, 139, 100);
    private static final int COLOR_CHICA = Color.rgb(211, 166, 35);
    private static final int COLOR_CHICA_PRESSED = Color.rgb(163, 121, 20);
    private static final int COLOR_CHICA_STROKE = Color.rgb(255, 222, 105);
    private static final int COLOR_FOXY_MANGLE = Color.rgb(178, 58, 89);
    private static final int COLOR_FOXY_MANGLE_PRESSED = Color.rgb(124, 37, 64);
    private static final int COLOR_FOXY_MANGLE_STROKE = Color.rgb(238, 154, 174);
    private static final String SESSION_DETAILS =
            "Each session uses user-approved MediaProjection screen capture "
                    + "at the display's native resolution. Audio is not an app operation: "
                    + "the host records the phone's A2DP mix. "
                    + "Teach panels are non-interactive overlay windows placed clear of "
                    + "every region the helper reads. "
                    + "Stop and restart for a fresh session, then open the game.";

    private MediaProjectionManager projectionManager;
    private TextView statusView;
    private TextView diagnosticView;
    private TextView runnerStatusView;
    private Button diagnosticToggleButton;
    private Button termuxButton;
    private Button runNightButton;
    private Button stopNightButton;
    private Spinner routeSpinner;
    private Spinner presetSpinner;
    private Button captureButton;
    private Button overlayButton;
    private TextView overlayStatusView;
    private Typeface hudTypeface;
    private boolean captureRunning;
    private boolean receiverRegistered;
    private boolean overlayEnableAfterSettings;
    private boolean diagnosticsVisible;
    private volatile String lastScreen = "UNKNOWN";
    private volatile boolean nightRunnerRunning;
    private String bridgeToken;
    private TermuxBridge termuxBridge;
    private NightRunner nightRunner;
    private Thread nightRunnerThread;
    private RunnerCatalog runnerCatalog;
    private RunnerCatalog.Route selectedRoute;
    private RunnerCatalog.Preset selectedPreset;
    private int selectedTab;

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!CaptureService.ACTION_STATUS.equals(intent.getAction())) {
                return;
            }
            String status = intent.getStringExtra(CaptureService.EXTRA_STATUS);
            if (status != null) {
                if (statusView != null) {
                    statusView.setText(sessionStatus(status));
                }
                lastScreen = CompanionStatus.broadcastField(status, "screen");
                if (diagnosticView != null) {
                    diagnosticView.setText(status);
                }
                refreshOverlayControls(status);
                if (status.startsWith("RUNNING") || status.startsWith("STARTING")) {
                    setCaptureRunning(true);
                } else if (status.startsWith("UNAVAILABLE")) {
                    setCaptureRunning(false);
                }
                refreshRunnerReadiness();
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            selectedTab = savedInstanceState.getInt("selectedTab", 0);
            diagnosticsVisible = savedInstanceState.getBoolean("diagnosticsVisible", false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        }
        projectionManager = getSystemService(MediaProjectionManager.class);
        try {
            hudTypeface = Typeface.createFromAsset(getAssets(), "fonts/hud-font.otf");
        } catch (RuntimeException error) {
            // Keep the helper usable if a stripped/custom build omits the optional asset.
            hudTypeface = Typeface.DEFAULT;
        }
        try {
            runnerCatalog = RunnerCatalog.load(getAssets());
        } catch (IOException error) {
            runnerCatalog = RunnerCatalog.unavailable(
                    "Runner catalog unavailable: " + error.getMessage());
        }
        setContentView(buildUi());
        // Registered for the Activity's whole life, not only while it is
        // visible: the runner's night gate reads lastScreen while the game,
        // not this Activity, is in front, and a receiver dropped at onStop
        // froze it at its last value.
        IntentFilter filter = new IntentFilter(CaptureService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(statusReceiver, filter);
        }
        receiverRegistered = true;
        applyTargetExtra(getIntent());
        refreshOverlayControls("overlay=" + (Settings.canDrawOverlays(this)
                ? "READY" : "DISABLED(permission)"));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putInt("selectedTab", selectedTab);
        outState.putBoolean("diagnosticsVisible", diagnosticsVisible);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onStart() {
        super.onStart();
        // Configuration changes recreate this Activity. Ask the service for
        // its current combined state so portrait and landscape do not wait for
        // the next sensor heartbeat to redraw the signal feed.
        startService(new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_QUERY_STATUS));
    }

    @Override
    protected void onResume() {
        super.onResume();
        CaptureService.companionForeground = true;
        refreshRunnerReadiness();
        if (overlayEnableAfterSettings) {
            overlayEnableAfterSettings = false;
            refreshOverlayControls("overlay=" + (Settings.canDrawOverlays(this)
                    ? "READY" : "DISABLED(permission)"));
        }
    }

    @Override
    protected void onDestroy() {
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver);
            receiverRegistered = false;
        }
        if (nightRunner != null) nightRunner.stop();
        if (termuxBridge != null) {
            releaseOffMainThread(termuxBridge);
            termuxBridge = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        CaptureService.companionForeground = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyTargetExtra(intent);
    }

    /**
     * The host's setup names the target in the launch intent
     * ({@code --es target <package|game>}); forward it to the service, which
     * validates it against {@link Targets} and persists it.
     */
    private void applyTargetExtra(Intent intent) {
        String named = intent == null ? null : intent.getStringExtra(CaptureService.EXTRA_TARGET);
        if (named == null) return;
        startService(new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_SET_TARGET)
                .putExtra(CaptureService.EXTRA_TARGET, named));
    }

    /** The named target, or null when none is named. */
    private Targets.Target currentTarget() {
        return Targets.byPackage(getSharedPreferences(CaptureService.PREFS, MODE_PRIVATE)
                .getString(CaptureService.PREF_TARGET, null));
    }


    private View buildUi() {
        int pad = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(18), pad, pad);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(COLOR_BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safeArea = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(
                        pad + safeArea.left,
                        dp(18) + safeArea.top,
                        pad + safeArea.right,
                        pad + safeArea.bottom);
                return insets;
            });
            root.post(root::requestApplyInsets);
        }

        root.addView(titleHeader(), matchWrap());

        FrameLayout pages = new FrameLayout(this);
        LinearLayout.LayoutParams pagesParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        pagesParams.setMargins(0, dp(8), 0, 0);

        Button[] tabs = new Button[2];
        String[] labels = {"HOME", "SETTINGS"};
        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setGravity(Gravity.CENTER);
        for (int index = 0; index < labels.length; index++) {
            final int tabIndex = index;
            tabs[index] = themedButton(labels[index], COLOR_PANEL,
                    COLOR_FREDDY_PRESSED, COLOR_PANEL_BORDER, COLOR_TEXT);
            tabs[index].setTextSize(11);
            tabs[index].setPadding(dp(4), 0, dp(4), 0);
            tabs[index].setOnClickListener(view -> selectTab(pages, tabs, tabIndex));
            LinearLayout.LayoutParams tabParams = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            tabParams.setMargins(dp(2), 0, dp(2), 0);
            tabBar.addView(tabs[index], tabParams);
        }
        root.addView(tabBar, matchWrap());

        pages.addView(sessionPage(), pageParams());
        pages.addView(configPage(), pageParams());
        root.addView(pages, pagesParams);
        selectTab(pages, tabs, Math.min(selectedTab, tabs.length - 1));

        return root;
    }

    private FrameLayout.LayoutParams pageParams() {
        return new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private void selectTab(FrameLayout pages, Button[] tabs, int selected) {
        selectedTab = selected;
        for (int index = 0; index < pages.getChildCount(); index++) {
            pages.getChildAt(index).setVisibility(index == selected
                    ? View.VISIBLE : View.GONE);
            if (tabs[index] != null) {
                tabs[index].setTextColor(index == selected ? COLOR_AMBER : COLOR_TEXT);
                tabs[index].setSelected(index == selected);
            }
        }
    }

    private ScrollView scrollPage(LinearLayout content) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(content, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private LinearLayout pageContent(String label) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(0, dp(4), 0, dp(12));
        content.addView(sectionLabel(label), matchWrap());
        return content;
    }

    private ScrollView sessionPage() {
        boolean landscape = getResources().getConfiguration().orientation
                == Configuration.ORIENTATION_LANDSCAPE;
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(landscape
                ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        content.setPadding(0, dp(4), 0, dp(12));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.addView(sectionLabel("PHONE SESSION"), matchWrap());
        actions.addView(bodyText("1  Start capture and approve screen sharing.\n"
                + "2  Open " + targetGameName() + ".\n3  Check the observed state."), matchWrap());
        actions.addView(captureButton(), matchWrap());
        actions.addView(openGameButton(), matchWrap());

        LinearLayout state = new LinearLayout(this);
        state.setOrientation(LinearLayout.VERTICAL);
        state.addView(sectionLabel("SESSION STATUS"), matchWrap());
        statusView = statusTextView();
        statusView.setText("Capture off\nStart capture to observe the game.");
        state.addView(statusView, matchWrap());
        state.addView(sectionLabel("LOCAL RUNNER"), matchWrap());
        runnerStatusView = bodyText("");
        state.addView(runnerStatusView, matchWrap());
        state.addView(sectionLabel("RUNNER ROUTE"), matchWrap());
        routeSpinner = routeSpinner();
        state.addView(routeSpinner, spinnerLayoutParams());
        state.addView(sectionLabel("NIGHT 7 PRESET"), matchWrap());
        presetSpinner = presetSpinner();
        state.addView(presetSpinner, spinnerLayoutParams());
        termuxButton = themedButton("Termux setup", COLOR_PANEL,
                COLOR_FREDDY_PRESSED, COLOR_PANEL_BORDER, COLOR_TEXT);
        termuxButton.setOnClickListener(view -> openTermux());
        state.addView(termuxButton, matchWrap());
        runNightButton = themedButton("Run selected route", COLOR_FOXY_MANGLE,
                COLOR_FOXY_MANGLE_PRESSED, COLOR_FOXY_MANGLE_STROKE, COLOR_TEXT);
        runNightButton.setOnClickListener(view -> runSelectedRoute());
        state.addView(runNightButton, matchWrap());
        stopNightButton = themedButton("Stop local route", COLOR_PANEL,
                COLOR_FREDDY_PRESSED, COLOR_PANEL_BORDER, COLOR_TEXT);
        stopNightButton.setEnabled(false);
        stopNightButton.setOnClickListener(view -> stopSelectedRoute());
        state.addView(stopNightButton, matchWrap());

        if (landscape) {
            LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            left.setMargins(0, 0, dp(10), 0);
            content.addView(actions, left);
            LinearLayout.LayoutParams right = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            right.setMargins(dp(10), 0, 0, 0);
            content.addView(state, right);
        } else {
            content.addView(actions, matchWrap());
            content.addView(state, matchWrap());
        }
        return scrollPage(content);
    }

    private Spinner routeSpinner() {
        Spinner spinner = new Spinner(this);
        CatalogAdapter adapter = new CatalogAdapter(runnerCatalog == null
                ? java.util.Collections.emptyList() : runnerCatalog.routes);
        spinner.setAdapter(adapter);
        spinner.setMinimumHeight(dp(48));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view,
                    int position, long id) {
                selectedRoute = runnerCatalog == null ? null : runnerCatalog.routeAt(position);
                refreshRunnerReadiness();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                selectedRoute = null;
                refreshRunnerReadiness();
            }
        });
        return spinner;
    }

    private Spinner presetSpinner() {
        Spinner spinner = new Spinner(this);
        CatalogAdapter adapter = new CatalogAdapter(runnerCatalog == null
                ? java.util.Collections.emptyList() : runnerCatalog.presets);
        spinner.setAdapter(adapter);
        spinner.setMinimumHeight(dp(48));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view,
                    int position, long id) {
                selectedPreset = runnerCatalog == null ? null : runnerCatalog.presetAt(position);
                refreshRunnerReadiness();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                selectedPreset = null;
                refreshRunnerReadiness();
            }
        });
        return spinner;
    }

    private final class CatalogAdapter extends ArrayAdapter<RunnerCatalog.Item> {
        CatalogAdapter(List<? extends RunnerCatalog.Item> items) {
            super(MainActivity.this, android.R.layout.simple_spinner_item);
            if (items != null) {
                for (RunnerCatalog.Item item : items) add(item);
            }
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        }

        @Override
        public boolean areAllItemsEnabled() {
            return false;
        }

        @Override
        public boolean isEnabled(int position) {
            RunnerCatalog.Item item = getItem(position);
            return item != null && item.isRunnable();
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            return bind(super.getView(position, convertView, parent), position);
        }

        @Override
        public View getDropDownView(int position, View convertView, ViewGroup parent) {
            return bind(super.getDropDownView(position, convertView, parent), position);
        }

        private View bind(View view, int position) {
            RunnerCatalog.Item item = getItem(position);
            if (view instanceof TextView && item != null) {
                TextView text = (TextView) view;
                text.setText(item.displayLabel());
                text.setTextColor(item.isRunnable() ? COLOR_TEXT : COLOR_MUTED);
                text.setAlpha(item.isRunnable() ? 1f : 0.58f);
                text.setPadding(dp(12), dp(8), dp(12), dp(8));
            }
            return view;
        }
    }

    private ScrollView configPage() {
        LinearLayout content = pageContent("OVERLAY");
        overlayStatusView = statusTextView();
        overlayStatusView.setText(Settings.canDrawOverlays(this)
                ? "overlay=READY" : "overlay=DISABLED(permission)");
        content.addView(overlayStatusView, matchWrap());
        overlayButton = themedButton("Overlay permission", COLOR_CHICA,
                COLOR_CHICA_PRESSED, COLOR_CHICA_STROKE,
                Color.rgb(35, 24, 5));
        overlayButton.setOnClickListener(view -> toggleOverlay());
        content.addView(overlayButton, matchWrap());
        content.addView(sectionLabel("DIAGNOSTICS"), matchWrap());
        diagnosticToggleButton = themedButton(
                diagnosticsVisible ? "Hide diagnostics" : "Show diagnostics",
                COLOR_PANEL, COLOR_FREDDY_PRESSED, COLOR_PANEL_BORDER, COLOR_TEXT);
        diagnosticToggleButton.setOnClickListener(view -> {
            diagnosticsVisible = !diagnosticsVisible;
            diagnosticView.setVisibility(diagnosticsVisible ? View.VISIBLE : View.GONE);
            diagnosticToggleButton.setText(diagnosticsVisible
                    ? "Hide diagnostics" : "Show diagnostics");
        });
        content.addView(diagnosticToggleButton, matchWrap());
        diagnosticView = statusTextView();
        diagnosticView.setVisibility(diagnosticsVisible ? View.VISIBLE : View.GONE);
        content.addView(diagnosticView, matchWrap());
        Button details = themedButton("Session details", COLOR_PANEL,
                COLOR_FREDDY_PRESSED, COLOR_PANEL_BORDER, COLOR_TEXT);
        details.setOnClickListener(view -> showSessionDetailsDialog());
        content.addView(details, matchWrap());
        content.addView(sectionLabel("APP"), matchWrap());
        content.addView(settingsRow(), matchWrap());
        return scrollPage(content);
    }

    private String sessionStatus(String raw) {
        if (raw == null || raw.isEmpty()) return "Capture off";
        String lifecycle = raw.split("\\n", 2)[0];
        if (lifecycle.startsWith("UNAVAILABLE")) return "Capture off\n" + lifecycle;
        return "Capture: " + lifecycle + "\nScreen: " + CompanionStatus.broadcastField(raw, "screen");
    }

    private boolean isTermuxInstalled() {
        try {
            getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException missing) {
            return false;
        }
    }

    private void refreshRunnerReadiness() {
        if (runnerStatusView == null || termuxButton == null) return;
        boolean installed = isTermuxInstalled();
        boolean connected = termuxBridge != null && termuxBridge.isConnected();
        if (!nightRunnerRunning) {
            StringBuilder status = new StringBuilder();
            if (runnerCatalog != null && runnerCatalog.loadWarning != null) {
                status.append(runnerCatalog.loadWarning);
            } else if (selectedRoute == null) {
                status.append("Select a runner route. Unqualified routes stay disabled.");
            } else {
                status.append(selectedRoute.displayLabel()).append("\n")
                        .append(selectedRoute.statusLine());
                if (requiresNight7Preset(selectedRoute)) {
                    status.append("\n");
                    if (selectedPreset == null) {
                        status.append("Disabled: select a Night 7 preset.");
                    } else {
                        status.append("Preset: ").append(selectedPreset.displayLabel())
                                .append("\n");
                        status.append(selectedPreset.isRunnable() ? "Preset ready."
                                : "Disabled: ").append(selectedPreset.disabledReason());
                    }
                }
            }
            status.append("\n");
            if (!installed) {
                status.append("Termux is not installed. Install it to enable local HID.");
            } else if (connected) {
                status.append("Termux bridge connected.");
            } else {
                status.append("Termux is installed. Copy the bridge command, paste it in Termux, then return here.");
            }
            runnerStatusView.setText(status.toString());
        }
        termuxButton.setText(installed ? "Prepare Termux bridge" : "Install Termux");
        boolean routeReady = selectedRoute != null && selectedRoute.isRunnable()
                && (!requiresNight7Preset(selectedRoute)
                || (selectedPreset != null && selectedPreset.isRunnable()));
        if (runNightButton != null) {
            runNightButton.setEnabled(installed && captureRunning
                    && "FNAF2_NIGHT".equals(lastScreen)
                    && routeReady && !nightRunnerRunning);
        }
        if (stopNightButton != null) {
            stopNightButton.setEnabled(nightRunnerRunning);
        }
    }

    private boolean requiresNight7Preset(RunnerCatalog.Route route) {
        return route != null && route.night == 7 && "minus7".equals(route.strategy);
    }

    private void openTermux() {
        if (isTermuxInstalled()) {
            bridgeToken = bridgeToken();
            TermuxBridge bridge = new TermuxBridge(bridgeToken);
            ClipboardManager clipboard = getSystemService(ClipboardManager.class);
            if (clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText(
                        "FNaF Companion Termux bridge", bridge.command()));
            }
            runnerStatusView.setText("Bridge command copied. Paste it in Termux, wait for ADB, then return here.");
            Toast.makeText(this, "Bridge command copied to clipboard", Toast.LENGTH_LONG).show();
            Intent launch = getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
            if (launch != null) {
                startActivity(launch);
                return;
            }
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(TERMUX_STORE_URI))
                    .setPackage("com.android.vending"));
        } catch (ActivityNotFoundException missingStore) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(TERMUX_STORE_URL)));
        }
    }

    private String bridgeToken() {
        if (bridgeToken == null) {
            bridgeToken = getPreferences(MODE_PRIVATE).getString("termuxBridgeToken", null);
        }
        if (bridgeToken != null && bridgeToken.matches("[0-9a-f]{32}")) return bridgeToken;
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder(32);
        for (byte item : bytes) value.append(String.format("%02x", item & 0xff));
        bridgeToken = value.toString();
        getPreferences(MODE_PRIVATE).edit().putString("termuxBridgeToken", bridgeToken).apply();
        return bridgeToken;
    }

    private void runSelectedRoute() {
        if (nightRunnerRunning) return;
        if (selectedRoute == null) {
            runnerStatusView.setText("Runner blocked: select a route first.");
            return;
        }
        if (!selectedRoute.isRunnable()) {
            runnerStatusView.setText("Runner blocked: " + selectedRoute.disabledReason());
            Toast.makeText(this, "Selected route is disabled", Toast.LENGTH_LONG).show();
            return;
        }
        if (requiresNight7Preset(selectedRoute)
                && (selectedPreset == null || !selectedPreset.isRunnable())) {
            runnerStatusView.setText("Runner blocked: the selected Night 7 preset is disabled.");
            Toast.makeText(this, "Selected Night 7 preset is disabled", Toast.LENGTH_LONG).show();
            return;
        }
        if (!isTermuxInstalled()) {
            openTermux();
            return;
        }
        if (!captureRunning) {
            runnerStatusView.setText("Runner blocked: start video capture first.");
            Toast.makeText(this, "Start video capture first", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!"FNAF2_NIGHT".equals(lastScreen)) {
            runnerStatusView.setText("Runner blocked: enter the selected night and wait for FNAF2_NIGHT observation.");
            Toast.makeText(this, "Open the selected night before starting the route", Toast.LENGTH_LONG).show();
            return;
        }
        final String token = bridgeToken();
        nightRunnerRunning = true;
        refreshRunnerReadiness();
        final RunnerCatalog.Route route = selectedRoute;
        nightRunner = new NightRunner(getAssets(), route);
        nightRunnerThread = new Thread(() -> {
            TermuxBridge bridge = new TermuxBridge(token);
            termuxBridge = bridge;
            try {
                postRunnerStatus("Connecting to Termux bridge...");
                bridge.connect(2_000);
                postRunnerStatus("Bridge connected. Starting the bounded "
                        + route.displayLabel() + " stream...");
                nightRunner.execute(bridge, () -> "FNAF2_NIGHT".equals(lastScreen), this::postRunnerStatus);
            } catch (Exception error) {
                postRunnerStatus("Route stopped: " + error.getMessage());
            } finally {
                bridge.sendRelease();
                bridge.close();
                termuxBridge = null;
                nightRunnerRunning = false;
                runOnUiThread(this::refreshRunnerReadiness);
            }
        }, "local-route-runner");
        nightRunnerThread.start();
    }

    private void stopSelectedRoute() {
        if (!nightRunnerRunning) return;
        if (nightRunner != null) nightRunner.stop();
        TermuxBridge bridge = termuxBridge;
        if (bridge != null) releaseOffMainThread(bridge);
        postRunnerStatus("Stopping local route...");
    }

    /**
     * Releases every contact and closes the bridge on its own thread. Both are
     * socket writes: on the main thread they throw NetworkOnMainThreadException,
     * which the bridge's IOException handling does not catch.
     */
    private static void releaseOffMainThread(TermuxBridge bridge) {
        new Thread(bridge::close, "route-release").start();
    }

    private void postRunnerStatus(String text) {
        runOnUiThread(() -> {
            if (runnerStatusView != null && nightRunnerRunning) runnerStatusView.setText(text);
        });
    }

    private void refreshOverlayControls(String status) {
        if (status == null) return;
        for (String line : status.split("\\n")) {
            if (!line.startsWith("overlay=")) continue;
            if (overlayStatusView != null) {
                overlayStatusView.setText(line);
            }
            if (overlayButton != null) {
                overlayButton.setText("Overlay permission");
            }
            return;
        }
    }

    /** Teach panels need "display over other apps"; open its settings page. */
    private void toggleOverlay() {
        overlayEnableAfterSettings = true;
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
        intent.setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }

    private TextView statusTextView() {
        TextView view = new TextView(this);
        view.setText("UNAVAILABLE: capture has not started");
        view.setTextIsSelectable(true);
        view.setTextSize(14);
        view.setTextColor(COLOR_TEXT);
        view.setTypeface(Typeface.MONOSPACE);
        view.setGravity(Gravity.TOP);
        view.setPadding(dp(12), dp(12), dp(12), dp(12));
        view.setBackground(panelBackground());
        return view;
    }

    private TextView bodyText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(14);
        view.setTextColor(COLOR_MUTED);
        view.setPadding(dp(8), dp(8), dp(8), dp(8));
        return view;
    }

    private TextView sectionLabel(String label) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextSize(12);
        view.setTextColor(COLOR_AMBER);
        view.setTypeface(hudTypeface);
        view.setGravity(Gravity.CENTER);
        view.setLetterSpacing(0.14f);
        return view;
    }

    private TextView titleHeader() {
        TextView title = new TextView(this);
        title.setText("FNaF Companion");
        title.setTextSize(24);
        title.setTextColor(COLOR_AMBER);
        title.setTypeface(hudTypeface);
        title.setGravity(Gravity.CENTER);
        title.setLetterSpacing(0.04f);
        return title;
    }

    private LinearLayout settingsRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        Button settings = themedButton(
                "App settings", COLOR_FOXY_MANGLE, COLOR_FOXY_MANGLE_PRESSED,
                COLOR_FOXY_MANGLE_STROKE, COLOR_TEXT);
        settings.setOnClickListener(view -> {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(android.net.Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        });
        row.addView(settings, new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Button help = themedButton(
                "?", COLOR_TEXT, Color.rgb(226, 204, 193),
                COLOR_FOXY_MANGLE_STROKE, Color.BLACK);
        help.setTextSize(20);
        help.setPadding(0, 0, 0, 0);
        help.setContentDescription("Session details");
        help.setOnClickListener(view -> showSessionDetailsDialog());
        LinearLayout.LayoutParams helpParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        helpParams.setMargins(dp(4), 0, 0, 0);
        row.addView(help, helpParams);
        return row;
    }

    private void showSessionDetailsDialog() {
        TextView details = new TextView(this);
        details.setText(SESSION_DETAILS);
        details.setTextSize(16);
        details.setTextColor(COLOR_TEXT);
        details.setTypeface(hudTypeface);
        details.setTextIsSelectable(true);
        details.setPadding(dp(24), dp(8), dp(24), dp(8));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(details, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Session details")
                .setView(scroll)
                .setPositiveButton("Close", null)
                .create();
        dialog.setOnShowListener(ignored -> {
            Button close = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            if (close != null) {
                close.setAllCaps(false);
                close.setTypeface(hudTypeface);
                close.setTextColor(COLOR_AMBER);
            }
        });
        dialog.show();
    }

    private Button captureButton() {
        captureButton = themedButton(
                captureRunning ? "Stop video capture" : "Start video capture",
                COLOR_FREDDY, COLOR_FREDDY_PRESSED,
                COLOR_FREDDY_STROKE, COLOR_TEXT);
        captureButton.setOnClickListener(view -> toggleCapture());
        return captureButton;
    }

    private Button openGameButton() {
        Button openGame = themedButton(
                "Open " + targetGameName(), COLOR_CHICA, COLOR_CHICA_PRESSED,
                COLOR_CHICA_STROKE, Color.rgb(35, 24, 5));
        openGame.setOnClickListener(view -> openGame());
        return openGame;
    }

    private void setCaptureRunning(boolean running) {
        captureRunning = running;
        if (captureButton != null) {
            captureButton.setText(running ? "Stop video capture" : "Start video capture");
        }
    }

    private void toggleCapture() {
        if (!captureRunning) {
            requestProjection();
            return;
        }
        Intent intent = new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_STOP);
        startService(intent);
        setCaptureRunning(false);
    }

    private Button themedButton(String label, int fill, int pressedFill,
            int stroke, int textColor) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(14);
        button.setTextColor(textColor);
        button.setTypeface(hudTypeface);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setPadding(dp(12), dp(8), dp(12), dp(8));
        button.setBackground(buttonBackground(fill, pressedFill, stroke));
        return button;
    }

    private Drawable buttonBackground(int fill, int pressedFill, int stroke) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_pressed},
                roundedBackground(pressedFill, stroke));
        states.addState(new int[]{}, roundedBackground(fill, stroke));
        return states;
    }

    private GradientDrawable roundedBackground(int fill, int stroke) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(fill);
        background.setCornerRadius(dp(8));
        background.setStroke(dp(1), stroke);
        return background;
    }

    private GradientDrawable panelBackground() {
        GradientDrawable background = new GradientDrawable();
        background.setColor(COLOR_PANEL);
        background.setCornerRadius(dp(8));
        background.setStroke(dp(1), COLOR_PANEL_BORDER);
        return background;
    }

    private void requestProjection() {
        Intent request;
        if (Build.VERSION.SDK_INT >= 34) {
            request = projectionManager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay());
        } else {
            request = projectionManager.createScreenCaptureIntent();
        }
        startActivityForResult(request, REQUEST_MEDIA_PROJECTION);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_MEDIA_PROJECTION) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            setCaptureRunning(false);
            statusView.setText("UNAVAILABLE: projection consent denied");
            return;
        }

        Intent service = new Intent(this, CaptureService.class)
                .setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(CaptureService.EXTRA_RESULT_DATA, data);
        startForegroundService(service);
        setCaptureRunning(true);
        statusView.setText("STARTING: waiting for the first native frame");
    }

    /** Display name of the named target, from the installed package when it can be read. */
    private String targetGameName() {
        Targets.Target target = currentTarget();
        if (target == null) return "the game";
        PackageManager packages = getPackageManager();
        try {
            return packages.getApplicationLabel(
                    packages.getApplicationInfo(target.packageName, 0)).toString();
        } catch (PackageManager.NameNotFoundException absent) {
            return target.label;
        }
    }

    /** Bring the named target to the front without restarting it. */
    private void openGame() {
        Targets.Target target = currentTarget();
        if (target == null) {
            Toast.makeText(this, "No target is named", Toast.LENGTH_LONG).show();
            return;
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(target.packageName);
        if (launch == null) {
            Toast.makeText(this, target.label + " is not installed", Toast.LENGTH_LONG).show();
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launch);
    }

    private LinearLayout.LayoutParams matchWrap() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(4), 0, dp(4));
        return params;
    }

    private LinearLayout.LayoutParams spinnerLayoutParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        params.setMargins(0, dp(4), 0, dp(4));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
