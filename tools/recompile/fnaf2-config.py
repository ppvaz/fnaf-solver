# Chowdren --config for the owned build-296 FNaF2 CCN. Toolchain code only:
# it overrides what the stock converter cannot yet handle for this mobile game.
# No game content -- the CCN, APK, and generated output stay outside the repo.
#
# Usage:  python -m chowdren.run --config tools/recompile/fnaf2-config.py \
#             <external-owned.ccn> <external-gamesrc>
# Context: docs/in-engine/IN-ENGINE-PILOT-RECOMPILE.md
#          "Phase 2 -- generate boundaries".

# --- extension identity ------------------------------------------------------
#
# The mobile CCN's desktop-format ExtensionList chunk (8756) is 4 bytes / zero
# items, so game.extensions is empty while frame items reference extension
# object types. Chowdren resolves an extension object as
# extensions.fromHandle(objectType - 32); with nothing parsed that raises.
#
# We synthesize one entry per distinct extension objectType found in the frame
# items. The name decides which Chowdren writer is used: a known name binds the
# real writer, an unknown name falls back to the generic ObjectWriter stub
# (load_extension_module(..., use_default=True)). "Multiple Touch" is a generic
# stub here and becomes the pilot input hook in a later phase (Plan 17 WP4).

EXTENSION_BASE = 32

# objectType -> Chowdren extension-writer name. Types not listed keep a
# sanitized version of their editor name and get the generic stub.
EXTENSION_NAMES = {
    47: 'Layer',           # "Layer object" -> Chowdren's native Layer writer
    33: 'kcini',           # Android Extensions/CRunkcini is Clickteam's INI, same ACE table; binds to
                           # the Ini objects once build 296's XOR-28 handles are unscrambled
    46: 'MultipleTouch',   # harness writer (base/harness.*): scripted touches
    35: 'Kyso',            # Android Extensions/CRunKyso: the jumpscare flipbooks
                           # (writers/extensions/Kyso.py, base/objects/kyso.*)
    40: 'AndroidObject',   # no-op stub
    43: 'AndroidPlus',     # no-op stub
    42: 'iOSPlus',         # no-op stub
}


class _SyntheticExtension(object):
    """Minimal stand-in for mmfparser's Extension: fromHandle / the ACE and
    object-writer lookups only read .handle and .name."""
    def __init__(self, handle, name):
        self.handle = handle
        self.name = name
        self.extension = name
        self.subType = ''
        self.magicNumber = 0
        self.versionLS = 0
        self.versionMS = 0

    def __repr__(self):
        return '<SyntheticExtension %d %r>' % (self.handle, self.name)


def _sanitize(name):
    keep = [c for c in name if c.isalnum()]
    return ''.join(keep) or 'Extension'


def init(converter):
    converter.add_define('CHOWDREN_POINT_FILTER')
    converter.add_define('CHOWDREN_QUICK_SCALE')

    # The mobile CCN's AppName carries Android's string-resource escape
    # ("Freddy\\'s"); aapt consumes it for the launcher label ("Five Nights at
    # Freddy's 2", aapt2 dump badging of the retail APK), so the window title and
    # CMake's APP_NAME take it unescaped.
    for game in converter.games:
        if game.name and "\\'" in game.name:
            game.name = game.name.replace("\\'", "'")

    for game in converter.games:
        exts = game.extensions
        if exts is None or exts.items:
            continue

        seen = {}
        for item in game.frameItems.itemDict.itervalues():
            ot = item.objectType
            if ot < EXTENSION_BASE or ot in seen:
                continue
            handle = ot - EXTENSION_BASE
            name = EXTENSION_NAMES.get(ot) or _sanitize(item.name)
            seen[ot] = _SyntheticExtension(handle, name)

        exts.items = list(seen.values())
        if exts.preloadExtensions is None:
            exts.preloadExtensions = 0
        print 'fnaf2-config: synthesized %d extension entries: %s' % (
            len(exts.items),
            ', '.join('%d=%s' % (e.handle + EXTENSION_BASE, e.name)
                      for e in exts.items))


# --- missing images --------------------------------------------------------
def get_fonts(converter):
    # AndroidSans.dat (tools/recompile/make-android-fonts.py): Roboto at the
    # font bank's pixel sizes, the face Android substitutes for Consolas and
    # Tahoma. SmallFonts, Chowdren's default, drew every text tiny.
    return ['AndroidSans']


def get_missing_image(converter, image):
    # Build 296's object direction frames carry placeholder handle (0, 0) for
    # slots the mobile runtime never draws. Draw nothing there: substitute a
    # fully transparent image from the bank. The first real image, the old
    # substitute, is a minigame sprite, and it showed on invisible objects
    # (whereToGo on the title, the office's parked Pause controls).
    for handle, color in sorted(converter.solid_images.items()):
        if len(color) == 4 and color[3] == 0 and handle in converter.image_indexes:
            print 'fnaf2-config: missing image %s -> transparent %s' % (repr(image), repr(handle))
            return converter.image_indexes[handle]
    print 'fnaf2-config: missing image %s -> first image (no transparent image)' % repr(image)
    return converter.image_indexes.itervalues().next()
