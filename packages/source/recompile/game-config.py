# Chowdren --config for the other build-296 mobile CCNs (FNaF 1, 3, 4): the
# FNaF 2 config's overrides with extension identity resolved by item name, not
# by object type number, since each game numbers its extensions differently.
# Toolchain code only; the CCN, APK and generated output stay outside the repo.
#
#   MMFPARSER_ANDROID_RAW_DIR=<apk res/raw> MMFPARSER_OI_XOR=<k> MMFPARSER_LO_XOR=<l> \
#   CHOWDREN_IMAGE_COMPRESS=zlib CHOWDREN_IMAGE_WORKERS=2 python -m chowdren.run \
#       --config packages/source/recompile/game-config.py <owned.ccn> <gamesrc>
#
# The object-handle XORs are per game, read from each APK's dex
# (OI/COI.loadHeader, Frame/CLO.load) and set before the CCN is parsed, so they
# are environment variables, not config: FNaF 1 0/0, FNaF 2 28/48 (the
# defaults), FNaF 3 29/50, FNaF 4 29/62.

EXTENSION_BASE = 32

# Item-name rules -> Chowdren writer. The mobile CCN's ExtensionList is empty,
# so the frame items' names (the porter's "<name>.<EXT>" convention, or the
# object's default editor name) are what identifies an extension.
SUFFIX_NAMES = {
    'KYSO': 'Kyso',            # Android Extensions/CRunKyso flipbooks
    'Ini': 'kcini',            # Clickteam INI
}
EXACT_NAMES = {
    'Multiple Touch': 'MultipleTouch',
    'Layer object': 'Layer',
    'Ini': 'kcini',
    'AndroidPlus': 'AndroidPlus',
    'Android object': 'AndroidObject',
    'iOS Plus Object': 'iOSPlus',
    'Perspective': 'Perspective',
}


class _SyntheticExtension(object):
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


def _writer_name(names):
    for name in names:
        if name in EXACT_NAMES:
            return EXACT_NAMES[name]
    for name in names:
        suffix = name.rsplit('.', 1)[-1] if '.' in name else None
        if suffix in SUFFIX_NAMES:
            return SUFFIX_NAMES[suffix]
    return _sanitize(sorted(names)[0])


def init(converter):
    converter.add_define('CHOWDREN_POINT_FILTER')
    converter.add_define('CHOWDREN_QUICK_SCALE')

    for game in converter.games:
        exts = game.extensions
        if exts is None or exts.items:
            continue
        by_type = {}
        for item in game.frameItems.itemDict.itervalues():
            if item.objectType >= EXTENSION_BASE:
                by_type.setdefault(item.objectType, []).append(item.name)
        exts.items = [_SyntheticExtension(ot - EXTENSION_BASE, _writer_name(names))
                      for ot, names in sorted(by_type.items())]
        if exts.preloadExtensions is None:
            exts.preloadExtensions = 0
        print 'game-config: synthesized %d extension entries: %s' % (
            len(exts.items),
            ', '.join('%d=%s' % (e.handle + EXTENSION_BASE, e.name)
                      for e in exts.items))


def get_fonts(converter):
    # AndroidSans.dat (make-android-fonts.py): the Roboto faces Android
    # substitutes for the bank's Windows fonts.
    return ['AndroidSans']


def get_missing_image(converter, image):
    # Placeholder handle (0, 0) frames draw nothing: use a fully transparent
    # image from the bank, as the FNaF 2 config does.
    for handle, color in sorted(converter.solid_images.items()):
        if len(color) == 4 and color[3] == 0 and handle in converter.image_indexes:
            print 'game-config: missing image %s -> transparent %s' % (repr(image), repr(handle))
            return converter.image_indexes[handle]
    print 'game-config: missing image %s -> first image (no transparent image)' % repr(image)
    return converter.image_indexes.itervalues().next()
