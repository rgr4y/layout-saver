import * as vscode from 'vscode';
import * as path from 'path';

interface LayoutData {
    layout: any; // VS Code's EditorGroupLayout type
    documents: Array<{
        relativePath: string;
        column: number;
        pinned: boolean;
    }>;
    panelVisible?: boolean;
}

const EXT_ID = 'layoutSaver';
const CMD_ID = 'layout';
const MAX_FAILED_FILES_BEFORE_TRUNCATION = 3;

function getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(EXT_ID);
}

export function activate(context: vscode.ExtensionContext) {
    // Migrate old single layout to new multi-layout format
    migrateOldLayout();

    context.subscriptions.push(
        vscode.commands.registerCommand(`${CMD_ID}.save`, saveLayout),
        vscode.commands.registerCommand(`${CMD_ID}.load`, loadLayout)
    );
}

async function migrateOldLayout() {
    const config = getConfig();
    const oldLayout = config.get<LayoutData>('layout');
    const newLayouts = config.get<Record<string, LayoutData>>('layouts') || {};
    
    // If old layout exists and new layouts is empty, migrate it
    if (oldLayout && Object.keys(oldLayout).length > 0 && Object.keys(newLayouts).length === 0) {
        try {
            await vscode.workspace.getConfiguration().update(
                `${EXT_ID}.layouts`,
                { 'default': oldLayout },
                vscode.ConfigurationTarget.Workspace
            );
            // Clear the old layout
            await vscode.workspace.getConfiguration().update(
                `${EXT_ID}.layout`,
                undefined,
                vscode.ConfigurationTarget.Workspace
            );
            vscode.window.showInformationMessage('Layout Saver: Migrated old layout to "default"');
        } catch (error) {
            vscode.window.showWarningMessage('Layout Saver: Failed to migrate old layout. You may need to save it again.');
        }
    }
}

async function saveLayout() {
    const tabs = getValidTextTabs();
    if (!tabs.length) return notify('No valid tabs to save (untitled tabs are ignored)', true);

    // Get existing layouts to show in the prompt
    const config = getConfig();
    const existingLayouts = config.get<Record<string, LayoutData>>('layouts') || {};
    const existingNames = Object.keys(existingLayouts);
    
    // Use QuickPick to show existing layouts and allow entering a new name
    const items: vscode.QuickPickItem[] = existingNames.map(name => ({
        label: name,
        description: '(existing layout - will overwrite)'
    }));
    
    // Add option to enter new name
    items.unshift({
        label: '$(add) Enter new layout name...',
        description: 'Create a new named layout',
        alwaysShow: true
    });

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: existingNames.length > 0 
            ? 'Select existing layout to overwrite, or create new'
            : 'Enter new layout name',
        ignoreFocusOut: true
    });

    if (!selection) return; // User cancelled

    let layoutName: string | undefined;
    
    if (selection.label.startsWith('$(add)')) {
        // User wants to enter a new name
        layoutName = await vscode.window.showInputBox({
            prompt: 'Enter new layout name',
            placeHolder: 'my-layout',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Layout name cannot be empty';
                }
                return null;
            }
        });
    } else {
        // User selected an existing layout
        layoutName = selection.label;
    }

    if (!layoutName) return; // User cancelled

    // Check if panel (bottom bar with terminals) is visible
    // We check for active terminals that haven't exited
    const hasActiveTerminals = vscode.window.terminals.some(t => !t.exitStatus);
    // Note: We can't reliably check if the panel is actually visible via API
    // So we use terminal existence as a proxy - if terminals exist, panel was likely visible
    const isPanelVisible = hasActiveTerminals;

    const layout: LayoutData = {
        layout: await run('vscode.getEditorLayout'),
        documents: tabs
            .sort((a, b) => a.group.viewColumn - b.group.viewColumn)
            .map(tab => ({
                relativePath: vscode.workspace.asRelativePath(tab.input.uri),
                column: tab.group.viewColumn,
                pinned: tab.isPinned
            })),
        panelVisible: isPanelVisible
    };

    try {
        // Save to named layouts collection
        const layouts = { ...existingLayouts, [layoutName]: layout };
        await vscode.workspace.getConfiguration().update(
            `${EXT_ID}.layouts`,
            layouts,
            vscode.ConfigurationTarget.Workspace
        );
        notify(`Layout "${layoutName}" saved successfully`);
    } catch {
        notify('Failed to save layout', true);
    }
}

async function loadLayout() {
    // Get current configuration
    const config = getConfig();
    const layouts = config.get<Record<string, LayoutData>>('layouts') || {};
    const layoutNames = Object.keys(layouts);

    if (layoutNames.length === 0) {
        return notify('No saved layouts found', true);
    }

    // Prompt to select a layout
    let layoutName: string | undefined;
    if (layoutNames.length === 1) {
        layoutName = layoutNames[0];
    } else {
        layoutName = await vscode.window.showQuickPick(layoutNames, {
            placeHolder: 'Select a layout to restore'
        });
    }

    if (!layoutName) return; // User cancelled

    const saved = layouts[layoutName];
    if (!saved?.documents || !saved?.layout) {
        return notify(`Layout "${layoutName}" is invalid or corrupted`, true);
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return notify('No workspace folder found', true);

    // Handle sidebar visibility first
    if (config.get('hideSideBarAfterOpen')) {
        await run('workbench.action.focusSideBar');
        await run('workbench.action.toggleSidebarVisibility');
    }

    // Apply the layout structure (columns) to set up the grid
    // This only affects editor groups, not terminals
    await run('vscode.setEditorLayout', saved.layout);

    // Handle panel (terminal area) visibility
    // For backward compatibility, default to true when panelVisible wasn't saved
    // If layout explicitly had no terminals (panelVisible: false), always hide the panel
    // If layout had terminals (panelVisible: true), only show if active terminals exist
    const shouldShowPanel = saved.panelVisible !== undefined ? saved.panelVisible : true;
    const hasExistingTerminals = vscode.window.terminals.some(t => !t.exitStatus);
    
    if (shouldShowPanel && hasExistingTerminals) {
        // Show the panel with existing terminals (don't create new ones)
        await run('workbench.action.terminal.focus');
        // Return focus to editor
        await run('workbench.action.focusActiveEditorGroup');
    } else if (!shouldShowPanel) {
        // Always hide the panel if layout had no terminals, regardless of current terminal state
        await run('workbench.action.closePanel');
    }
    // If shouldShowPanel but no terminals exist, do nothing (don't create terminals)

    // Track files that couldn't be opened
    const failedFiles: string[] = [];

    // Process all files from the saved layout
    for (const { relativePath, column, pinned } of saved.documents) {
        const absPath = path.join(workspaceRoot, relativePath);
        const uri = vscode.Uri.file(absPath);

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            
            // Show the document in the correct column
            // If it's already open, VS Code will move it; if not, it will open it
            await vscode.window.showTextDocument(doc, {
                viewColumn: column,
                preview: false,
                preserveFocus: true
            });

            // Update pinned state if needed
            if (pinned) {
                await run('workbench.action.pinEditor');
            }
        } catch (error) {
            failedFiles.push(relativePath);
        }
    }

    // Provide appropriate feedback based on results
    if (failedFiles.length === 0) {
        notify(`Layout "${layoutName}" restored successfully`);
    } else if (failedFiles.length === saved.documents.length) {
        notify(`Failed to restore layout "${layoutName}": no files could be opened`, true);
    } else {
        // Show warning for partial failures
        // Show first N files when truncating, but don't truncate unless we save at least 2 names
        // (e.g., with N=3: show all for 1-4 files, truncate to "3 and X more" for 5+)
        const fileList = failedFiles.length <= MAX_FAILED_FILES_BEFORE_TRUNCATION + 1
            ? failedFiles.join(', ')
            : `${failedFiles.slice(0, MAX_FAILED_FILES_BEFORE_TRUNCATION).join(', ')} and ${failedFiles.length - MAX_FAILED_FILES_BEFORE_TRUNCATION} more`;
        vscode.window.showWarningMessage(`Layout Saver: Layout "${layoutName}" restored with ${failedFiles.length} file(s) unavailable: ${fileList}`);
    }
}

function isTextTab(tab: vscode.Tab): tab is vscode.Tab & { input: vscode.TabInputText } {
    return tab.input instanceof vscode.TabInputText;
}

function getValidTextTabs(): (vscode.Tab & { input: vscode.TabInputText })[] {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(isTextTab)
        .filter(tab => tab.input.uri.scheme === 'file'); // only save actual files
}

function notify(msg: string, isError = false) {
    const full = `Layout Saver: ${msg}`;
    return isError ? vscode.window.showErrorMessage(full) : vscode.window.showInformationMessage(full);
}

function run(command: string, args?: any) {
    return vscode.commands.executeCommand(command, args);
}

export function deactivate() {}