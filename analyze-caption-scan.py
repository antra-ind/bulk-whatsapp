import json

d = json.load(open('wa-caption-scan-result.json'))

print('=== BASELINE ===')
print('Editable count:', d['baseline']['count'])
for e in d['baseline']['elements']:
    print(f'  tab={e["dataTab"]} label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}" visible={e["visible"]}')

print()
print('=== PREVIEW ===')
print('Editable count:', d['preview']['editableCount'])
for e in d['preview']['editables']:
    print(f'  tab={e["dataTab"]} label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}" visible={e["visible"]}')
    print(f'    rect: x={e["rect"]["x"]:.0f} y={e["rect"]["y"]:.0f} w={e["rect"]["width"]:.0f} h={e["rect"]["height"]:.0f}')

print()
print('=== NEW EDITABLES IN PREVIEW ===')
print('Count:', len(d.get('newEditablesInPreview', [])))
for e in d.get('newEditablesInPreview', []):
    print(f'  tab={e["dataTab"]} label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}"')
    print(f'    outerHTML: {e["outerHTML"][:300]}')

print()
print('=== CAPTION-RELATED (BASELINE) ===')
for e in d.get('baselineCaptionRelated', []):
    print(f'  tag={e["tag"]} text="{e["text"][:80]}" placeholder="{e.get("placeholder","")}"')

print()
print('=== CAPTION-RELATED (PREVIEW) ===')
for e in d.get('previewCaptionRelated', []):
    print(f'  tag={e["tag"]} text="{e["text"][:80]}" placeholder="{e.get("placeholder","")}" editable={e.get("contentEditable")}')
    print(f'    outerHTML: {e["outerHTML"][:300]}')

print()
print('=== ELEMENT AT TAB10 CENTER ===')
e = d.get('elementAtTab10Center')
if e:
    print(f'  tag={e["tag"]} editable={e["contentEditable"]} tab={e.get("dataTab")} isSameAsTab10={e.get("isSameAsTab10")}')
    print(f'  label="{e.get("ariaLabel","")}" placeholder="{e.get("ariaPlaceholder","")}"')
    print(f'  outerHTML: {e.get("outerHTML","")[:400]}')
else:
    print('  (not found)')

print()
print('=== TAB10 IN PREVIEW ===')
e = d.get('tab10InPreview')
if e:
    print(f'  label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}"')
    print(f'  rect: x={e["rect"]["x"]:.0f} y={e["rect"]["y"]:.0f} w={e["rect"]["width"]:.0f} h={e["rect"]["height"]:.0f}')

print()
print('=== EDITABLES NEAR SEND BUTTON ===')
for e in d.get('editablesNearSendButton', []):
    print(f'  tab={e["dataTab"]} label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}"')
    print(f'    rect: x={e["rect"]["x"]:.0f} y={e["rect"]["y"]:.0f} w={e["rect"]["width"]:.0f} h={e["rect"]["height"]:.0f}')

print()
print('=== LEXICAL EDITORS ===')
for e in d.get('lexicalEditors', []):
    print(f'  class="{e["class"][:80]}" visible={e["visible"]}')
    if e.get('childEditable'):
        c = e['childEditable']
        print(f'    child: tab={c.get("dataTab")} label="{c.get("ariaLabel","")}" placeholder="{c.get("ariaPlaceholder","")}"')

print()
print('=== FOCUS TESTS (elementFromPoint near send button) ===')
for t in d.get('focusTests', []):
    e = t['element']
    print(f'  point=({t["testPoint"]["x"]:.0f},{t["testPoint"]["y"]:.0f}) -> tag={e["tag"]} editable={e["contentEditable"]} tab={e.get("dataTab")} role={e.get("role")} label="{e.get("ariaLabel","")}"')

print()
print('=== PREVIEW TEXTBOXES ===')
for e in d.get('previewTextboxes', []):
    print(f'  tab={e["dataTab"]} label="{e.get("ariaLabel","")}" placeholder="{e.get("placeholder","")}" visible={e["visible"]}')
    print(f'    rect: x={e["rect"]["x"]:.0f} y={e["rect"]["y"]:.0f} w={e["rect"]["width"]:.0f} h={e["rect"]["height"]:.0f}')
