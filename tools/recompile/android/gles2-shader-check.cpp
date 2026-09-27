// gles2-shader-check: compile and link Chowdren's desktop GLSL 1.20 shaders as
// GLSL ES 1.00 on a host GL ES 2.0 driver (Mesa, headless EGL), through the
// same rewrite the rebuild's GLES2 renderer uses (base/gles2shader.h), and
// render the Perspective shader's PANORAMA branch over a synthetic texture
// against a CPU evaluation of the Android runtime's formula
// (panorama_ext_frag.fsh: fC = 1 + sin(u * 3.1415) * fB - fB, fB = zoom /
// image height). Content-free: it reads only the shader sources and draws
// only generated pixels.
//
// Build (Khronos EGL/GLES2 headers, Mesa's libEGL/libGLESv2):
//   c++ -O1 -std=gnu++11 -I <anaconda>/Chowdren/base gles2-shader-check.cpp -lEGL -lGLESv2
// Run:
//   ./gles2-shader-check <anaconda>/Chowdren/base/shaders [--dump DIR] > result.json
// Exit status 0 only when every shader pair compiles and links and the
// PANORAMA render matches the reference.

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include "gles2shader.h"

#include <dirent.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <algorithm>
#include <string>
#include <vector>

static std::string read_file(const std::string & path, bool * ok)
{
    FILE * f = fopen(path.c_str(), "rb");
    *ok = f != NULL;
    std::string s;
    if (!f)
        return s;
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0)
        s.append(buf, n);
    fclose(f);
    return s;
}

static std::string json_escape(const std::string & s)
{
    std::string o;
    for (size_t i = 0; i < s.size(); i++) {
        char c = s[i];
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (c == '\n') o += "\\n";
        else if ((unsigned char)c < 0x20) o += ' ';
        else o += c;
    }
    return o;
}

static GLuint compile(GLenum type, const std::string & src, std::string * log,
                      bool * ok)
{
    GLuint sh = glCreateShader(type);
    const char * p = src.c_str();
    GLint len = (GLint)src.size();
    glShaderSource(sh, 1, &p, &len);
    glCompileShader(sh);
    GLint status = 0, n = 0;
    glGetShaderiv(sh, GL_COMPILE_STATUS, &status);
    glGetShaderiv(sh, GL_INFO_LOG_LENGTH, &n);
    if (n > 1) {
        std::vector<char> b(n + 1);
        glGetShaderInfoLog(sh, n, NULL, &b[0]);
        *log += &b[0];
    }
    *ok = status == GL_TRUE;
    return sh;
}

static GLuint build_program(const std::string & vsrc, const std::string & fsrc,
                            bool * vok, bool * fok, bool * lok,
                            std::string * log)
{
    GLuint vs = compile(GL_VERTEX_SHADER, gles2_translate_shader(
        vsrc.data(), vsrc.size(), true), log, vok);
    GLuint fs = compile(GL_FRAGMENT_SHADER, gles2_translate_shader(
        fsrc.data(), fsrc.size(), false), log, fok);
    GLuint prog = glCreateProgram();
    glAttachShader(prog, vs);
    glAttachShader(prog, fs);
    // the same bindings as glslshader.cpp's non-GL branch
    glBindAttribLocation(prog, POSITION_ATTRIB_IDX, POSITION_ATTRIB_NAME);
    glBindAttribLocation(prog, TEXCOORD1_ATTRIB_IDX, TEXCOORD1_ATTRIB_NAME);
    glBindAttribLocation(prog, TEXCOORD2_ATTRIB_IDX, TEXCOORD2_ATTRIB_NAME);
    glBindAttribLocation(prog, COLOR_ATTRIB_IDX, COLOR_ATTRIB_NAME);
    glLinkProgram(prog);
    GLint status = 0, n = 0;
    glGetProgramiv(prog, GL_LINK_STATUS, &status);
    glGetProgramiv(prog, GL_INFO_LOG_LENGTH, &n);
    if (n > 1) {
        std::vector<char> b(n + 1);
        glGetProgramInfoLog(prog, n, NULL, &b[0]);
        *log += &b[0];
    }
    *lok = *vok && *fok && status == GL_TRUE;
    glDeleteShader(vs);
    glDeleteShader(fs);
    return prog;
}

static bool make_context(std::string * how)
{
    EGLDisplay dpy = EGL_NO_DISPLAY;
    PFNEGLGETPLATFORMDISPLAYEXTPROC get_platform_display =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC)
        eglGetProcAddress("eglGetPlatformDisplayEXT");
    const char * client = eglQueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS);
    if (get_platform_display && client &&
        strstr(client, "EGL_MESA_platform_surfaceless")) {
        dpy = get_platform_display(EGL_PLATFORM_SURFACELESS_MESA,
                                   EGL_DEFAULT_DISPLAY, NULL);
        *how = "EGL_PLATFORM_SURFACELESS_MESA";
    }
    if (dpy == EGL_NO_DISPLAY) {
        dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        *how = "eglGetDisplay(EGL_DEFAULT_DISPLAY)";
    }
    if (dpy == EGL_NO_DISPLAY || !eglInitialize(dpy, NULL, NULL))
        return false;
    eglBindAPI(EGL_OPENGL_ES_API);
    // everything renders into an FBO, so no window-system surface is needed
    // where EGL_KHR_surfaceless_context exists; otherwise a small pbuffer
    const char * ext = eglQueryString(dpy, EGL_EXTENSIONS);
    bool surfaceless = ext && strstr(ext, "EGL_KHR_surfaceless_context");
    EGLint cfg_attr[] = {EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
                         EGL_SURFACE_TYPE, surfaceless ? 0 : EGL_PBUFFER_BIT,
                         EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
                         EGL_NONE};
    EGLConfig cfg;
    EGLint n = 0;
    if (!eglChooseConfig(dpy, cfg_attr, &cfg, 1, &n) || n < 1)
        return false;
    EGLint ctx_attr[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctx_attr);
    if (ctx == EGL_NO_CONTEXT)
        return false;
    EGLSurface surf = EGL_NO_SURFACE;
    if (!surfaceless) {
        EGLint pb[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
        surf = eglCreatePbufferSurface(dpy, cfg, pb);
        if (surf == EGL_NO_SURFACE)
            return false;
    }
    *how += surfaceless ? ", surfaceless context" : ", pbuffer";
    return eglMakeCurrent(dpy, surf, surf, ctx) == EGL_TRUE;
}

// Render perspective.frag's PANORAMA branch the way PerspectiveObject::draw
// does (a copied W x H screen, NEAREST as CHOWDREN_QUICK_SCALE sets the back
// texture, texture_size = 1/W, 1/H, the object's zoom), and count the pixels
// whose source row differs from the CPU formula.
static void panorama_test(GLuint prog, int W, int H, int zoom, FILE * out)
{
    // texel (x, y) encodes its own coordinates
    std::vector<unsigned char> tex(size_t(W) * H * 4);
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
            unsigned char * p = &tex[(size_t(y) * W + x) * 4];
            p[0] = x & 0xFF; p[1] = y & 0xFF;
            p[2] = ((x >> 8) & 0xF) | (((y >> 8) & 0xF) << 4); p[3] = 255;
        }
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, W, H, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, &tex[0]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    GLuint target, fbo;
    glGenTextures(1, &target);
    glBindTexture(GL_TEXTURE_2D, target);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, W, H, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0,
                           GL_TEXTURE_2D, target, 0);
    GLenum fbs = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    glViewport(0, 0, W, H);
    glDisable(GL_BLEND);

    glUseProgram(prog);
    glUniform1i(glGetUniformLocation(prog, TEXTURE_SAMPLER_NAME), 0);
    glUniform2f(glGetUniformLocation(prog, SIZE_UNIFORM_NAME),
                1.0f / W, 1.0f / H);
    glUniform1i(glGetUniformLocation(prog, "effect"), 0);
    glUniform1i(glGetUniformLocation(prog, "direction"), 0);
    glUniform1i(glGetUniformLocation(prog, "zoom"), zoom);
    glUniform1i(glGetUniformLocation(prog, "offset"), 0);
    glUniform1i(glGetUniformLocation(prog, "sine_waves"), 4);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, t);

    // a quad over the target with texcoords 0..1, as render_texcoords are
    static const float pos[12] = {-1, -1, 1, -1, 1, 1, 1, 1, -1, 1, -1, -1};
    static const float tc[12] = {0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0};
    static const unsigned char col[24] = {255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255};
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glVertexAttribPointer(POSITION_ATTRIB_IDX, 2, GL_FLOAT, GL_FALSE, 0, pos);
    glEnableVertexAttribArray(POSITION_ATTRIB_IDX);
    glVertexAttribPointer(TEXCOORD1_ATTRIB_IDX, 2, GL_FLOAT, GL_FALSE, 0, tc);
    glEnableVertexAttribArray(TEXCOORD1_ATTRIB_IDX);
    glVertexAttribPointer(COLOR_ATTRIB_IDX, 4, GL_UNSIGNED_BYTE, GL_TRUE, 0,
                          col);
    glEnableVertexAttribArray(COLOR_ATTRIB_IDX);
    glDrawArrays(GL_TRIANGLES, 0, 6);

    std::vector<unsigned char> px(size_t(W) * H * 4);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, &px[0]);
    GLenum err = glGetError();

    long exact = 0, off1 = 0, worse = 0, xwrong = 0;
    int max_row_err = 0;
    double fB = double(zoom) / H;
    for (int y = 0; y < H; y++)
        for (int x = 0; x < W; x++) {
            const unsigned char * p = &px[(size_t(y) * W + x) * 4];
            int sx = p[0] | ((p[2] & 0xF) << 8);
            int sy = p[1] | ((p[2] >> 4) << 8);
            double u = (x + 0.5) / W, v = (y + 0.5) / H;
            double fC = 1.0 + sin(u * 3.1415) * fB - fB;
            double vv = v * fC + (1.0 - fC) / 2.0;
            int ry = std::min(H - 1, std::max(0, int(floor(vv * H))));
            if (sx != x)
                xwrong++;
            int d = abs(sy - ry);
            max_row_err = std::max(max_row_err, d);
            if (d == 0) exact++;
            else if (d == 1) off1++;
            else worse++;
        }
    long total = long(W) * H;
    fprintf(out, "  \"panorama\": {\"width\": %d, \"height\": %d, \"zoom\": %d, "
            "\"fB\": %.6f, \"framebufferStatus\": \"0x%x\", \"glError\": \"0x%x\", "
            "\"pixels\": %ld, \"rowExact\": %ld, \"rowOffByOne\": %ld, "
            "\"rowWorse\": %ld, \"maxRowError\": %d, \"columnWrong\": %ld, "
            "\"centreColumnRowsAtEdge\": [%d, %d], \"edgeColumnRowsAtEdge\": [%d, %d]},\n",
            W, H, zoom, fB, fbs, err, total, exact, off1, worse, max_row_err,
            xwrong,
            // at the centre column the band is the whole height; at the edge
            // column only the middle (1 - fB) of it
            px[(size_t(0) * W + W / 2) * 4 + 1] | ((px[(size_t(0) * W + W / 2) * 4 + 2] >> 4) << 8),
            px[(size_t(H - 1) * W + W / 2) * 4 + 1] | ((px[(size_t(H - 1) * W + W / 2) * 4 + 2] >> 4) << 8),
            px[(size_t(0) * W + 0) * 4 + 1] | ((px[(size_t(0) * W + 0) * 4 + 2] >> 4) << 8),
            px[(size_t(H - 1) * W + 0) * 4 + 1] | ((px[(size_t(H - 1) * W + 0) * 4 + 2] >> 4) << 8));
    // pass: no column moves, and every row lands on the formula's texel or
    // its neighbour (fp32 on the GPU against doubles here, at texel edges)
    bool pass = fbs == GL_FRAMEBUFFER_COMPLETE && err == GL_NO_ERROR &&
                xwrong == 0 && worse == 0 && exact * 100 >= total * 99;
    fprintf(out, "  \"panoramaPass\": %s,\n", pass ? "true" : "false");
}

int main(int argc, char ** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s SHADER_DIR [--dump DIR]\n", argv[0]);
        return 2;
    }
    std::string dir = argv[1];
    std::string dump;
    for (int i = 2; i + 1 < argc; i++)
        if (strcmp(argv[i], "--dump") == 0)
            dump = argv[i + 1];

    std::string how;
    if (!make_context(&how)) {
        fprintf(stderr, "no GL ES 2.0 context (EGL error 0x%x)\n", eglGetError());
        return 3;
    }

    std::vector<std::string> names;
    DIR * d = opendir(dir.c_str());
    if (!d) {
        fprintf(stderr, "cannot open %s\n", dir.c_str());
        return 2;
    }
    struct dirent * e;
    while ((e = readdir(d)) != NULL) {
        std::string n = e->d_name;
        if (n.size() > 5 && n.compare(n.size() - 5, 5, ".frag") == 0)
            names.push_back(n.substr(0, n.size() - 5));
    }
    closedir(d);
    std::sort(names.begin(), names.end());

    printf("{\n  \"schema\": \"gles2-shader-check-v1\",\n");
    printf("  \"context\": {\"egl\": \"%s\", \"renderer\": \"%s\", "
           "\"version\": \"%s\", \"glsl\": \"%s\"},\n",
           how.c_str(), json_escape((const char*)glGetString(GL_RENDERER)).c_str(),
           json_escape((const char*)glGetString(GL_VERSION)).c_str(),
           json_escape((const char*)glGetString(GL_SHADING_LANGUAGE_VERSION)).c_str());

    int failed = 0;
    GLuint perspective = 0;
    std::string rows;
    for (size_t i = 0; i < names.size(); i++) {
        bool ok1, ok2;
        std::string vsrc = read_file(dir + "/" + names[i] + ".vert", &ok1);
        std::string fsrc = read_file(dir + "/" + names[i] + ".frag", &ok2);
        if (!ok1 || !ok2) {
            char b[256];
            snprintf(b, sizeof(b), "    {\"name\": \"%s\", \"missing\": true}",
                     names[i].c_str());
            rows += std::string(rows.empty() ? "" : ",\n") + b;
            failed++;
            continue;
        }
        if (!dump.empty()) {
            std::string v = gles2_translate_shader(vsrc.data(), vsrc.size(), true);
            std::string f = gles2_translate_shader(fsrc.data(), fsrc.size(), false);
            FILE * fv = fopen((dump + "/" + names[i] + ".vert").c_str(), "wb");
            if (fv) { fwrite(v.data(), 1, v.size(), fv); fclose(fv); }
            FILE * ff = fopen((dump + "/" + names[i] + ".frag").c_str(), "wb");
            if (ff) { fwrite(f.data(), 1, f.size(), ff); fclose(ff); }
        }
        bool vok, fok, lok;
        std::string log;
        GLuint prog = build_program(vsrc, fsrc, &vok, &fok, &lok, &log);
        if (!lok)
            failed++;
        if (names[i] == "perspective" && lok)
            perspective = prog;
        std::string row = "    {\"name\": \"" + names[i] + "\", \"vertex\": " +
            (vok ? "true" : "false") + ", \"fragment\": " +
            (fok ? "true" : "false") + ", \"linked\": " +
            (lok ? "true" : "false") + ", \"log\": \"" + json_escape(log) + "\"}";
        rows += std::string(rows.empty() ? "" : ",\n") + row;
    }
    printf("  \"shaders\": [\n%s\n  ],\n", rows.c_str());
    printf("  \"shaderPairs\": %d,\n  \"failed\": %d,\n", (int)names.size(), failed);
    bool panorama_ok = false;
    if (perspective != 0) {
        // FNaF 2's office Perspective object: 1024 x 768, zoom 200
        FILE * tmp = tmpfile();
        panorama_test(perspective, 1024, 768, 200, tmp);
        rewind(tmp);
        char buf[4096];
        size_t n;
        std::string s;
        while ((n = fread(buf, 1, sizeof(buf), tmp)) > 0)
            s.append(buf, n);
        fclose(tmp);
        fputs(s.c_str(), stdout);
        panorama_ok = s.find("\"panoramaPass\": true") != std::string::npos;
    } else {
        printf("  \"panoramaPass\": false,\n");
    }
    printf("  \"pass\": %s\n}\n", failed == 0 && panorama_ok ? "true" : "false");
    return failed == 0 && panorama_ok ? 0 : 1;
}
