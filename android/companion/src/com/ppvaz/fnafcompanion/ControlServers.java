package com.ppvaz.fnafcompanion;

import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * The control channel's two listeners: the IPv4 loopback port on-device
 * readers use and the abstract local socket a host reaches through
 * {@code adb forward}. Each accepts one bounded, token-checked request line
 * at a time and answers with ControlDispatcher's one line; the endpoint file
 * hands the token and names to hosts through app-private storage.
 */
final class ControlServers {
    static final int CONTROL_PORT = 49_707;
    private static final int CONTROL_LINE_LIMIT = 256;
    private static final int CONTROL_READ_TIMEOUT_MS = 1_000;
    private static final String CONTROL_SOCKET_PREFIX =
            "com.fnaf2.cuehelper.control";

    private final CaptureService service;
    private ServerSocket controlServer;
    private LocalServerSocket localControlServer;
    private Thread controlThread;
    private Thread localControlThread;
    private volatile boolean controlRunning;
    private volatile boolean tcpControlUp;
    private volatile boolean localControlUp;
    private String controlToken;
    private String controlSocketName;
    private volatile String lastControl = "control=UNAVAILABLE";

    ControlServers(CaptureService service) {
        this.service = service;
    }

    void start(long generation) throws IOException {
        byte[] tokenBytes = new byte[16];
        new SecureRandom().nextBytes(tokenBytes);
        char[] tokenChars = new char[tokenBytes.length * 2];
        final char[] hex = "0123456789abcdef".toCharArray();
        for (int i = 0; i < tokenBytes.length; i++) {
            int value = tokenBytes[i] & 0xff;
            tokenChars[i * 2] = hex[value >>> 4];
            tokenChars[i * 2 + 1] = hex[value & 0xf];
        }
        controlToken = new String(tokenChars);

        ServerSocket server = new ServerSocket();
        server.setReuseAddress(true);
        // Bind the IPv4 loopback explicitly. getLoopbackAddress() resolved to
        // ::1 on the API-36 target, and the device shell's nc reaches the
        // documented 127.0.0.1:49707 contract over IPv4 only.
        server.bind(new InetSocketAddress(
                InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), CONTROL_PORT), 1);
        controlServer = server;
        tcpControlUp = true;

        // The abstract socket is the cable-bound channel: `adb forward` reaches
        // it without the app opening a port any other process can probe. The
        // loopback port stays for on-device readers.
        controlSocketName = CONTROL_SOCKET_PREFIX + "."
                + Long.toUnsignedString(generation, 36);
        LocalServerSocket localServer = openLocalControlServer(controlSocketName);
        localControlServer = localServer;
        localControlUp = true;

        controlRunning = true;
        publishStatus();
        Log.i(CaptureService.TAG, lastControl);
        writeEndpoint(generation);

        controlThread = new Thread(() -> controlLoop(generation, server), "cue-control");
        controlThread.start();
        localControlThread = new Thread(
                () -> localControlLoop(generation, localServer), "cue-control-local");
        localControlThread.start();
    }

    /**
     * Hand the endpoint to hosts through app-private storage (read with
     * {@code run-as}), so a host never depends on a logcat line that a long
     * night rotates out of the 256 KiB ring. Written atomically; removed when
     * capture stops.
     */
    private void writeEndpoint(long generation) {
        CaptureService.AppVersion version = service.appVersion();
        String app = version.name;
        long code = version.code;
        String text = CompanionStatus.endpointProperties(app, code, generation,
                Process.myPid(), CONTROL_PORT, controlSocketName, controlToken);
        File target = new File(service.getFilesDir(), CompanionStatus.ENDPOINT_FILE);
        File staged = new File(service.getFilesDir(), CompanionStatus.ENDPOINT_FILE + ".new");
        try (FileOutputStream stream = new FileOutputStream(staged, false)) {
            stream.write(text.getBytes(StandardCharsets.US_ASCII));
        } catch (IOException error) {
            Log.e(CaptureService.TAG, "endpoint file write failed", error);
            return;
        }
        if (!staged.renameTo(target)) Log.e(CaptureService.TAG, "endpoint file rename failed");
        Log.i(CaptureService.TAG, CompanionStatus.endpointLogLine(app, code, generation, Process.myPid(),
                CONTROL_PORT, controlSocketName, controlToken));
    }

    void deleteEndpoint() {
        File file = new File(service.getFilesDir(), CompanionStatus.ENDPOINT_FILE);
        if (file.exists() && !file.delete()) Log.w(CaptureService.TAG, "endpoint file delete failed");
    }

    private LocalServerSocket openLocalControlServer(String socketName) throws IOException {
        IOException lastError = null;
        for (int attempt = 0; attempt < 10; attempt++) {
            try {
                return new LocalServerSocket(socketName);
            } catch (IOException error) {
                lastError = error;
                if (attempt < 9) {
                    SystemClock.sleep(50L);
                }
            }
        }
        throw lastError;
    }

    void publishStatus() {
        String state = tcpControlUp && localControlUp
                ? "READY"
                : tcpControlUp || localControlUp ? "DEGRADED" : "UNAVAILABLE";
        lastControl = "control=" + state
                + " port=" + (tcpControlUp ? String.valueOf(CONTROL_PORT) : "none")
                + " socket=" + (localControlUp ? controlSocketName : "none")
                + " token=" + (controlToken == null ? "none" : controlToken)
                + " " + service.legacy.watchStatus();
    }

    private void controlLoop(long generation, ServerSocket server) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        while (controlRunning && service.sessionActive(generation)) {
            try {
                Socket accepted = server.accept();
                try (Socket client = accepted) {
                    client.setSoTimeout(CONTROL_READ_TIMEOUT_MS);
                    serveControlRequest(client.getInputStream(), client.getOutputStream());
                } catch (IOException error) {
                    if (controlRunning && service.sessionActive(generation)) {
                        // A slow, disconnected, or malformed client loses only
                        // its own request. It cannot tear down the listener.
                        Log.w(CaptureService.TAG, "control client failed", error);
                    }
                }
            } catch (SocketException error) {
                // One dead listener must not silence the other channel, so the
                // shared shutdown flag is left alone here.
                if (controlRunning && service.sessionActive(generation)) {
                    Log.e(CaptureService.TAG, "control socket failed", error);
                    tcpControlUp = false;
                    publishStatus();
                    service.publishCombinedStatus("RUNNING");
                }
                break;
            } catch (Throwable error) {
                if (controlRunning && service.sessionActive(generation)) {
                    Log.w(CaptureService.TAG, "control request failed", error);
                }
            }
        }
    }

    private void localControlLoop(long generation, LocalServerSocket server) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        while (controlRunning && service.sessionActive(generation)) {
            try {
                LocalSocket accepted = server.accept();
                try (LocalSocket client = accepted) {
                    client.setSoTimeout(CONTROL_READ_TIMEOUT_MS);
                    serveControlRequest(client.getInputStream(), client.getOutputStream());
                } catch (IOException error) {
                    if (controlRunning && service.sessionActive(generation)) {
                        Log.w(CaptureService.TAG, "local control client failed", error);
                    }
                }
            } catch (IOException error) {
                if (controlRunning && service.sessionActive(generation)) {
                    Log.e(CaptureService.TAG, "local control socket failed", error);
                    localControlUp = false;
                    publishStatus();
                    service.publishCombinedStatus("RUNNING");
                }
                break;
            } catch (Throwable error) {
                if (controlRunning && service.sessionActive(generation)) {
                    Log.w(CaptureService.TAG, "local control request failed", error);
                }
            }
        }
    }

    private void serveControlRequest(InputStream input, OutputStream output)
            throws IOException {
        String request = readBoundedControlLine(input);
        String response;
        if (request == null) {
            response = "ERROR request-too-long";
        } else {
            String[] field = request.split(" ");
            String token = controlToken;
            if (field.length < 2 || token == null || !token.equals(field[1])) {
                response = "ERROR unauthorized";
            } else {
                response = service.dispatcher.dispatch(field);
            }
        }
        output.write((response + "\n").getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }

    private String readBoundedControlLine(InputStream input) throws IOException {
        byte[] bytes = new byte[CONTROL_LINE_LIMIT];
        int length = 0;
        while (length < bytes.length) {
            int value = input.read();
            if (value == -1 || value == '\n') {
                return new String(bytes, 0, length, StandardCharsets.US_ASCII);
            }
            if (value == '\r') {
                continue;
            }
            if (value < 0x20 || value > 0x7e) {
                return "";
            }
            bytes[length++] = (byte) value;
        }
        return null;
    }

    /** The listeners' line in the combined status. */
    String status() {
        return lastControl;
    }

    /** After a stop: the listeners are down, for this reason. */
    void markUnavailable(String reason) {
        lastControl = "control=UNAVAILABLE(" + reason + ")";
    }

    /** Close both listeners and wait for their threads; a later start opens new ones. */
    void stop() {
        controlRunning = false;
        ServerSocket server = controlServer;
        controlServer = null;
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
                // Closing an already-failed local server is still stopped.
            }
        }
        LocalServerSocket localServer = localControlServer;
        localControlServer = null;
        if (localServer != null) {
            try {
                localServer.close();
            } catch (IOException ignored) {
                // Closing an already-failed local server is still stopped.
            }
        }
        for (Thread worker : new Thread[] {controlThread, localControlThread}) {
            if (worker != null && worker != Thread.currentThread()) {
                worker.interrupt();
            }
        }
        service.joinWorker(controlThread);
        service.joinWorker(localControlThread);
        controlThread = null;
        localControlThread = null;
        tcpControlUp = false;
        localControlUp = false;
        controlToken = null;
        controlSocketName = null;
    }
}
