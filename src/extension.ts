import * as vscode from 'vscode';
import * as path from 'path';

const EXT_ID = 'layoutSaver';
const CMD_ID = 'layout';
const MAX_FAILED_FILES_BEFORE_TRUNCATION = 3;
let config: vscode.WorkspaceConfiguration;

export function activate(context: vscode.ExtensionContext) {
    config = vscode.workspace.getConfiguration(EXT_ID);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(EXT_ID)) {
                config = vscode.workspace.getConfiguration(EXT_ID);
            }
        }),
        vscode.commands.registerCommand(`${CMD_ID}.save`, saveLayout),
        vscode.commands.registerCommand(`${CMD_ID}.load`, loadLayout)
    );
}

async function saveLayout() {
    const tabs = getValidTextTabs();
    if (!tabs.length) return notify('No valid tabs to save (untitled tabs are ignored)', true);

    const layout = {
        layout: await run('vscode.getEditorLayout'),
        documents: tabs
            .sort((a, b) => a.group.viewColumn - b.group.viewColumn)
            .map(tab => ({
                relativePath: vscode.workspace.asRelativePath(tab.input.uri),
                column: tab.group.viewColumn,
                pinned: tab.isPinned
            }))
    };

    try {
        await vscode.workspace.getConfiguration().update(
            `${EXT_ID}.layout`,
            layout,
            vscode.ConfigurationTarget.Workspace
        );
        notify('Layout saved successfully');
    } catch {
        notify('Failed to save layout', true);
    }
}

async function loadLayout() {
    const saved = config.get<any>('layout');
    if (!saved?.documents || !saved?.layout) return notify('No saved layout found', true);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return notify('No workspace folder found', true);

    // Handle sidebar visibility first
    if (config.get('hideSideBarAfterOpen')) {
        await run('workbench.action.focusSideBar');
        await run('workbench.action.toggleSidebarVisibility');
    }

    // Apply the layout structure (columns) to set up the grid
    await run('vscode.setEditorLayout', saved.layout);

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
        notify('Layout restored successfully');
    } else if (failedFiles.length === saved.documents.length) {
        notify('Failed to restore layout: no files could be opened', true);
    } else {
        // Show warning for partial failures
        // Only truncate if we're saving at least 2 filenames (avoid "3 files and 1 more")
        const fileList = failedFiles.length <= MAX_FAILED_FILES_BEFORE_TRUNCATION + 1
            ? failedFiles.join(', ')
            : `${failedFiles.slice(0, MAX_FAILED_FILES_BEFORE_TRUNCATION).join(', ')} and ${failedFiles.length - MAX_FAILED_FILES_BEFORE_TRUNCATION} more`;
        vscode.window.showWarningMessage(`Layout Saver: Layout restored with ${failedFiles.length} file(s) unavailable: ${fileList}`);
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