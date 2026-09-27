package com.ppvaz.fnafcompanion;

import java.nio.ByteBuffer;

/**
 * One captured frame at the display's native resolution, read one unblended
 * pixel at a time.
 *
 * <p>This is the only view of a frame the game-agnostic readers take: the
 * region copier ({@link NativeRegions}), the whole-frame snap and the FNaF 2
 * legacy readers ({@link Fnaf2Legacy}). It has no Android dependency, so every
 * reader is exercised on the host by a synthetic frame.</p>
 */
public interface NativeFrame {
    /** A pixel that could not be read: outside the frame or a short buffer. */
    int UNKNOWN = Integer.MIN_VALUE;
    /** The calibrated handset's display (moto g56, landscape). */
    int WIDTH = 2400;
    int HEIGHT = 1080;

    int width();

    int height();

    /** 0xRRGGBB of native pixel (x, y), or {@link #UNKNOWN}. */
    int rgb(int x, int y);

    /** A reusable view over one ImageReader plane (RGBA_8888). */
    final class ByteBufferView implements NativeFrame {
        private ByteBuffer buffer;
        private int width;
        private int height;
        private int rowStride;
        private int pixelStride;

        public void set(ByteBuffer buffer, int width, int height,
                int rowStride, int pixelStride) {
            this.buffer = buffer;
            this.width = width;
            this.height = height;
            this.rowStride = rowStride;
            this.pixelStride = pixelStride;
        }

        @Override public int width() { return width; }

        @Override public int height() { return height; }

        @Override public int rgb(int x, int y) {
            if (buffer == null || x < 0 || y < 0 || x >= width || y >= height) {
                return UNKNOWN;
            }
            int offset = y * rowStride + x * pixelStride;
            if (offset < 0 || offset + 2 >= buffer.limit()) return UNKNOWN;
            return ((buffer.get(offset) & 0xff) << 16)
                    | ((buffer.get(offset + 1) & 0xff) << 8)
                    | (buffer.get(offset + 2) & 0xff);
        }
    }
}
