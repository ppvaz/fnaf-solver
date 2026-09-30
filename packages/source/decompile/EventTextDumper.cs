using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using CTFAK.CCN;
using CTFAK.CCN.Chunks.Frame;
using CTFAK.CCN.Chunks.Objects;
using CTFAK.Core.CCN.Chunks.Banks.ImageBank;
using CTFAK.FileReaders;
using CTFAK.MMFParser.EXE.Loaders.Events.Expressions;
using CTFAK.MMFParser.EXE.Loaders.Events.Parameters;

namespace CTFAK.Tools
{
    public class EventTextDumper : IFusionTool
    {
        public string Name => "Event Text Dumper";
        public int[] Progress => Array.Empty<int>();

        public void Execute(IFileReader reader)
        {
            GameData game = reader.getGameData();
            string output = Environment.GetEnvironmentVariable("CTFAK_EVENT_DUMP") ?? "events.txt";
            using var writer = new StreamWriter(output, false);

            writer.WriteLine($"GAME\t{Clean(game.name)}\tBUILD\t{game.productBuild}\tFRAMES\t{game.frames.Count}");
            writer.WriteLine("OBJECTS");
            foreach (var pair in game.frameitems.OrderBy(item => item.Key))
            {
                ObjectInfo info = pair.Value;
                string values = "";
                string strings = "";
                if (info.properties is ObjectCommon common)
                {
                    if (common.Values != null)
                        values = string.Join(",", common.Values.Items);
                    if (common.Strings != null)
                        strings = string.Join("|", common.Strings.Items.Select(Clean));
                }
                writer.WriteLine($"OBJECT\t{pair.Key}\tTYPE\t{info.ObjectType}\tNAME\t{Clean(info.name)}\tVALUES\t{values}\tSTRINGS\t{strings}");
                // One row per animation direction: the image handles its frames
                // draw, so `ForceAnimation N` on an object can be followed to a
                // picture. Keyed by the stored handle like the OBJECT row above.
                if (info.properties is ObjectCommon animated && animated.Animations?.AnimationDict != null)
                    foreach (var animation in animated.Animations.AnimationDict.OrderBy(a => a.Key))
                    {
                        var directions = animation.Value?.DirectionDict;
                        if (directions == null) continue;
                        foreach (var direction in directions.OrderBy(d => d.Key))
                        {
                            var frames = direction.Value?.Frames;
                            if (frames == null || frames.Count == 0) continue;
                            writer.WriteLine($"OBJANIM\tOI\t{pair.Key}\tANIM\t{animation.Key}\tDIR\t{direction.Key}\tFRAMES\t{string.Join(",", frames)}");
                        }
                    }
            }
            ExportImages(game);

            for (int frameIndex = 0; frameIndex < game.frames.Count; frameIndex++)
            {
                Frame frame = game.frames[frameIndex];
                int groupCount = frame.events?.Items.Count ?? 0;
                writer.WriteLine($"FRAME\t{frameIndex}\t{Clean(frame.name)}\tGROUPS\t{groupCount}");
                WriteFrameGeometry(writer, game, frame);
                if (frame.events == null) continue;

                for (int groupIndex = 0; groupIndex < frame.events.Items.Count; groupIndex++)
                {
                    EventGroup group = frame.events.Items[groupIndex];
                    writer.WriteLine($"GROUP\t{groupIndex}\tFLAGS\t{group.Flags}\tRESTRICT\t{group.IsRestricted}\tCONDS\t{group.Conditions.Count}\tACTS\t{group.Actions.Count}");
                    foreach (Condition condition in group.Conditions)
                        writer.WriteLine($" C\tOT\t{condition.ObjectType}\tNUM\t{condition.Num}\tOI\t{condition.ObjectInfo}\tNAME\t{ObjectName(game, condition.ObjectInfo)}\tOIL\t{condition.ObjectInfoList}\tCFLAGS\t{condition.Flags}\tCOTHER\t{condition.OtherFlags}\tPARAMS\t{Parameters(condition.Items)}");
                    foreach (CTFAK.CCN.Chunks.Frame.Action action in group.Actions)
                        writer.WriteLine($" A\tOT\t{action.ObjectType}\tNUM\t{action.Num}\tOI\t{action.ObjectInfo}\tNAME\t{ObjectName(game, action.ObjectInfo)}\tOIL\t{action.ObjectInfoList}\tPARAMS\t{Parameters(action.Items)}");
                }
            }
            Console.WriteLine($"Event text written to {output}");
        }

        /// <summary>
        /// Frame scene geometry: the frame's own size, its layers (with their
        /// parallax coefficients) and every placed object instance.
        ///
        /// Purely additive -- every existing line type is untouched, and the
        /// three new types (" F", " L", " I") are ignored by readers that only
        /// know GAME/OBJECTS/OBJECT/FRAME/GROUP/" C"/" A".
        ///
        /// OI is emitted RAW, exactly as the CCN stores it, the same contract
        /// the event lines' OI follows. On Android it is scrambled; the reader
        /// unscrambles (see docs/android/SOURCE-DUMP-GUIDE.md 4).
        ///
        /// W/H/HOTX/HOTY are the extents of animation 0, direction 0, frame 0 --
        /// the object's *default* appearance, which for a static hitbox or
        /// marker is its only one. An object whose current animation frame
        /// differs at runtime is NOT described by these numbers, and an object
        /// with no image bank entry emits them empty rather than guessing.
        /// </summary>
        private static void WriteFrameGeometry(StreamWriter writer, GameData game, Frame frame)
        {
            int layerCount = frame.layers?.Items?.Count ?? 0;
            int instanceCount = frame.objects?.Count ?? 0;
            writer.WriteLine($" F\tWIDTH\t{frame.width}\tHEIGHT\t{frame.height}\tLAYERS\t{layerCount}\tINSTANCES\t{instanceCount}");

            for (int layerIndex = 0; layerIndex < layerCount; layerIndex++)
            {
                Layer layer = frame.layers.Items[layerIndex];
                writer.WriteLine($" L\tIDX\t{layerIndex}\tNAME\t{Clean(layer.Name)}\tXC\t{layer.XCoeff}\tYC\t{layer.YCoeff}");
            }

            if (frame.objects == null) return;
            foreach (ObjectInstance instance in frame.objects)
            {
                string w = "", h = "", hotX = "", hotY = "";
                FusionImage image = FirstImage(game, instance.objectInfo);
                if (image != null)
                {
                    w = image.Width.ToString();
                    h = image.Height.ToString();
                    hotX = image.HotspotX.ToString();
                    hotY = image.HotspotY.ToString();
                }
                writer.WriteLine(
                    $" I\tINST\t{instance.handle}\tOI\t{instance.objectInfo}" +
                    $"\tNAME\t{ObjectName(game, instance.objectInfo)}" +
                    $"\tX\t{instance.x}\tY\t{instance.y}\tLAYER\t{instance.layer}" +
                    $"\tPTYPE\t{instance.parentType}\tPARENT\t{instance.parentHandle}" +
                    $"\tINSTNUM\t{instance.instance}" +
                    $"\tW\t{w}\tH\t{h}\tHOTX\t{hotX}\tHOTY\t{hotY}");
            }
        }

        /// <summary>
        /// Optional: write the images named by CTFAK_IMAGE_HANDLES (comma-separated
        /// image handles) as PNG files into CTFAK_IMAGE_DIR. Needs a GDI+ host
        /// (libgdiplus on Linux). Off unless both variables are set.
        /// </summary>
        private static void ExportImages(GameData game)
        {
            string dir = Environment.GetEnvironmentVariable("CTFAK_IMAGE_DIR");
            string handles = Environment.GetEnvironmentVariable("CTFAK_IMAGE_HANDLES");
            if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(handles)) return;
            Directory.CreateDirectory(dir);
            foreach (var token in handles.Split(','))
            {
                if (!int.TryParse(token.Trim(), out int handle)) continue;
                if (!game.Images.Items.TryGetValue(handle, out FusionImage image)) continue;
                image.bitmap.Save(Path.Combine(dir, $"{handle}.png"));
            }
        }

        /// <summary>
        /// The image behind animation 0 / direction 0 / frame 0 of an object,
        /// or null when the object has no animation, no frames, or the image
        /// bank was not loaded (CTFAK -noimg).
        /// </summary>
        private static FusionImage FirstImage(GameData game, int handle)
        {
            if (!game.frameitems.TryGetValue(handle, out ObjectInfo info)) return null;
            if (info.properties is not ObjectCommon common) return null;
            var animations = common.Animations?.AnimationDict;
            if (animations == null || animations.Count == 0) return null;
            foreach (var animation in animations.OrderBy(pair => pair.Key))
            {
                var directions = animation.Value?.DirectionDict;
                if (directions == null) continue;
                foreach (var direction in directions.OrderBy(pair => pair.Key))
                {
                    var frames = direction.Value?.Frames;
                    if (frames == null || frames.Count == 0) continue;
                    if (game.Images.Items.TryGetValue(frames[0], out FusionImage image))
                        return image;
                    return null;
                }
            }
            return null;
        }

        private static string ObjectName(GameData game, int handle)
        {
            return game.frameitems.TryGetValue(handle, out ObjectInfo info) ? Clean(info.name) : "";
        }

        private static string Parameters(IEnumerable<Parameter> parameters)
        {
            return string.Join(" || ", parameters.Select(parameter =>
            {
                if (parameter.Loader is ExpressionParameter expression)
                    return $"{parameter.Code}:ExpressionParameter:{Expression(expression)}";
                string rendered;
                try { rendered = parameter.Loader?.ToString() ?? "null"; }
                catch { rendered = "<render-error>"; }
                return $"{parameter.Code}:{Clean(parameter.Loader?.GetType().Name)}:{Clean(rendered)}";
            }));
        }

        private static string Expression(ExpressionParameter expression)
        {
            string items = string.Join(" ; ", expression.Items.Select((item, index) =>
            {
                string value = "null";
                if (item.Loader is ExpressionLoader loader)
                    value = Clean(loader.Value?.ToString());
                else if (item.Loader != null)
                    value = Clean(item.Loader.ToString());
                return $"[{index}]ot={item.ObjectType},num={item.Num},oi={item.ObjectInfo},oil={item.ObjectInfoList},loader={Clean(item.Loader?.GetType().Name)},value={value}";
            }));
            return $"cmp={expression.GetOperator()} {items}";
        }

        private static string Clean(string value)
        {
            return (value ?? "").Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
        }
    }
}
