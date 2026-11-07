import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('Inventory on hand: no header or toolbar, search and ONE menu button, table fills the screen', () => {
    const screen = read('src/org/InventoryOnHand.tsx');
    assert.doesNotMatch(screen, /<Screen\b|SelectField|eyebrow=|toolbar=/, 'the stacked title, subtitle, refresh and warehouse select are gone');
    assert.match(screen, /h-\[calc\(100dvh-7rem\)\]/, 'one full-height frame; the page itself never scrolls');
    assert.match(screen, /height='h-full'/, 'the table takes all of the frame');
    assert.match(screen, /menuTop=\{\(close\) =>/, 'screen choices live in the table menu');
    assert.match(screen, /role='radiogroup' aria-label='Warehouse'/, 'warehouse choice is in the menu');
    assert.match(screen, /warehouses\.length > 1 &&/, 'the warehouse choice appears only when there is more than one warehouse');
    assert.match(screen, /with stock ledger/, 'the status counts moved into the menu');
    assert.match(screen, /<span className='flex-1'>Refresh<\/span>/, 'refresh is in the menu');
    assert.match(screen, /Try again/, 'a failed load can still be retried');
    assert.match(screen, /id='inv\.onhand'/, 'saved table views keep working');
});

test('RichTable: menuTop puts screen choices and every table tool behind one menu button', () => {
    const table = read('src/components/RichTable.tsx');
    assert.match(table, /menuTop\?: \(close: \(\) => ReactNode\)|menuTop\?: \(close: \(\) => void\) => ReactNode/);
    assert.match(table, /const unified = !!menuTop;/);
    assert.match(table, /\$\{unified \? '' : 'sm:hidden'\}/, 'the menu button and sheet are shown on every screen size when unified');
    assert.match(table, /\{!unified && <div className='hidden items-center gap-2 sm:flex'>/, 'no second row of tool icons beside the menu button');
    assert.match(table, /\{!unified && <div className='hidden sm:block'>\{panelContent\}<\/div>\}/);
    assert.match(table, /menuTop\(\(\) => closeMobile\(false\)\)/, 'choosing something can close the menu');
    // Tables that do not pass menuTop keep the earlier behaviour.
    assert.match(table, /sm:hidden/);
    assert.match(table, /Export Excel/);
    assert.match(table, /track\('export', 'table\.export'/, 'Excel download is still audited');
});

test('material photos: the tap opens the camera or gallery, and a failure is shown next to the buttons', () => {
    const ui = read('src/org/MaterialOverview.tsx');
    assert.doesNotMatch(ui, /camera\.current|gallery\.current|\.click\(\)/, 'no script click on hidden inputs (ignored by some phone web views)');
    assert.match(ui, /<label aria-label=\{label\}/, 'the file input sits inside its label');
    assert.match(ui, /accept='image\/\*' capture='environment'/, 'camera capture');
    assert.match(ui, /accept='image\/\*' multiple/, 'gallery allows several photos');
    assert.match(ui, /e\.target\.value = '';/, 'the same photo can be chosen again');
    assert.match(ui, /Array\.from\(e\.target\.files \?\? \[\]\)/, 'files are copied before the input is cleared');
    assert.match(ui, /Saving photo \$\{n \+ 1\} of \$\{list\.length\}/, 'progress is shown');
    assert.match(ui, /cannot be shown yet/, 'a saved photo without a viewable link is reported, not hidden');
    const progressAt = ui.indexOf('{(progress || error) && (');
    const identityAt = ui.indexOf("className='min-w-0 space-y-2 p-4'");
    assert.ok(progressAt > 0 && progressAt < identityAt, 'status and errors sit directly under the photos, not at the bottom of the identity card');
    assert.equal((ui.match(/<Alert tone='error'>\{error\}<\/Alert>/g) || []).length, 1, 'one error display');
    assert.match(ui, /props\.canPhoto/, 'only people with the inventory edit right see the buttons');
});

test('Android wrapper: Take photo starts the camera app through a private FileProvider, no permissions added', () => {
    const java = read('android-dev-wrapper/app/src/main/java/com/manufusion/mems/devclient/MainActivity.java');
    assert.match(java, /fileChooserParams\.isCaptureEnabled\(\)/, 'the HTML capture request is honoured');
    assert.match(java, /MediaStore\.ACTION_IMAGE_CAPTURE/);
    assert.match(java, /FileProvider\.getUriForFile\(this, getPackageName\(\) \+ "\.captures", file\)/);
    assert.match(java, /fileChooserParams\.createIntent\(\)/, 'the gallery still uses the document picker');
    assert.match(java, /cameraFile\.length\(\) > 0/, 'a cancelled camera is not reported as a photo');
    assert.match(java, /purgeCaptures\(0\)/, 'captured photos are removed when the app closes');
    assert.match(java, /finishChooser\(null\)/, 'an earlier waiting request is always completed');
    const manifest = read('android-dev-wrapper/app/src/main/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /<uses-permission android:name="android\.permission\.(CAMERA|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA)/, 'no camera or storage permission is declared');
    assert.match(manifest, /android:authorities="\$\{applicationId\}\.captures"/);
    assert.match(manifest, /android:exported="false"/, 'the file provider is private');
    assert.match(manifest, /android:grantUriPermissions="true"/);
    assert.match(read('android-dev-wrapper/app/src/main/res/xml/file_paths.xml'), /<cache-path name="captures" path="captures\/" \/>/, 'only the capture folder is shared');
    assert.match(read('android-dev-wrapper/app/build.gradle.kts'), /androidx\.core:core:/);
});
