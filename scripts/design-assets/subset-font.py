"""Build the licensed display font with the real app's static text coverage.

Requires fontTools with Brotli; pass the original ZCOOL KuaiLe TTF as source.
Existing glyphs are retained so the accepted landing/cloud artwork stays intact.
"""
import argparse
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--font-tools', type=Path)
args = parser.parse_args()
if args.font_tools:
    sys.path.insert(0, str(args.font_tools.resolve()))
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[2]
output = root / 'apps/web/src/components/visual/assets/cloud-doodle.woff2'
with TTFont(output) as current:
    codepoints = set(current.getBestCmap())
for path in (root / 'apps/web/src').rglob('*'):
    if path.suffix in {'.tsx', '.ts', '.css'}:
        codepoints.update(map(ord, path.read_text(encoding='utf-8-sig')))
codepoints.update(range(32, 127))
options = subset.Options()
options.flavor = 'woff2'
font = subset.load_font(str(args.source.resolve()), options)
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=codepoints)
subsetter.subset(font)
subset.save_font(font, str(output), options)
with TTFont(output) as result:
    assert set('把想法变成一支队伍').issubset(set(map(chr, result.getBestCmap())))
print(f'Display font: {output.stat().st_size} bytes')
