import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { ChevronsDownUpIcon, ChevronsUpDownIcon, Plus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  onOpenFile: (relativePath: string) => void;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function normalizeEntryPath(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function canonicalTreePath(relativePath: string, kind: "file" | "directory"): string {
  return kind === "directory" ? `${relativePath}/` : relativePath;
}

function commandErrorMessage(result: AtomCommandResult<unknown, unknown>): string {
  if (result._tag === "Success") {
    return "";
  }
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : String(error);
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh workspace files"
            onClick={props.onRefresh}
          />
        }
      >
        <RotateCw className={cn(props.isPending && "animate-spin")} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? "Refreshing…" : "Refresh files"}</TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField(props: {
  ariaLabel: string;
  name: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1 rounded-md">
      <InputGroupInput
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Search files"
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const entries = entriesQuery.data?.entries ?? [];
  const createEntry = useAtomCommand(projectEnvironment.createEntry);
  const renameEntry = useAtomCommand(projectEnvironment.renameEntry);
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry);
  const pendingCreatesRef = useRef(new Map<string, "file" | "directory">());
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  const previousTreePathsRef = useRef<readonly string[]>([]);

  // The tree renders rows in shadow DOM and its anchor rect is unreliable, so
  // capture the right-click position ourselves; contextmenu is a composed
  // event, so a capture-phase listener sees it with viewport coordinates.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const capturePointer = (event: MouseEvent) => {
      contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    };
    document.addEventListener("contextmenu", capturePointer, true);
    return () => document.removeEventListener("contextmenu", capturePointer, true);
  }, []);

  const showEntryContextMenu = async (
    item: TreeContextMenuItem,
    context: TreeContextMenuOpenContext,
  ) => {
    const api = readLocalApi();
    if (!api) {
      context.close();
      return;
    }
    const relativePath = item.path.replace(/\/$/, "");
    const mention = serializeComposerFileLink(relativePath);
    const pointer = contextMenuPointerRef.current;
    const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
    const anchorRect = context.anchorElement.getBoundingClientRect();
    const position = pointerIsFresh
      ? { x: pointer.x, y: pointer.y }
      : { x: anchorRect.left, y: anchorRect.bottom };
    try {
      const items: Array<{ id: string; label: string }> = [];
      if (item.kind === "directory") {
        items.push(
          { id: "new-file", label: "New file" },
          { id: "new-folder", label: "New folder" },
        );
      }
      items.push(
        { id: "rename", label: "Rename" },
        { id: "delete", label: item.kind === "directory" ? "Delete folder" : "Delete" },
        { id: "copy-mention", label: "Copy mention" },
        { id: "add-to-chat", label: "Add to chat" },
      );
      const clicked = await api.contextMenu.show(items, position);
      if (clicked === "new-file") {
        startCreateEntry(relativePath, "file");
        return;
      }
      if (clicked === "new-folder") {
        startCreateEntry(relativePath, "directory");
        return;
      }
      if (clicked === "rename") {
        startRenameEntry(relativePath);
        return;
      }
      if (clicked === "delete") {
        void confirmDeleteEntry(relativePath, item.kind);
        return;
      }
      if (clicked === "copy-mention") {
        try {
          await writeTextToClipboard(mention);
          toastManager.add({ type: "success", title: "Mention copied", description: relativePath });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy mention",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "add-to-chat") {
        const composer = composerRef?.current;
        if (!composer) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "Open a chat for this project and try again.",
          });
          return;
        }
        const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
        if (!inserted) {
          toastManager.add({
            type: "error",
            title: "Unable to add to chat",
            description: "The chat isn't ready to accept input right now.",
          });
        }
      }
    } finally {
      context.close();
    }
  };
  const showEntryContextMenuRef = useRef(showEntryContextMenu);
  useEffect(() => {
    showEntryContextMenuRef.current = showEntryContextMenu;
  });

  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const dragMention = useMemo(
    () =>
      createFileTreeDragMentionController({
        deselect: (path) => treeModelRef.current?.getItem(path)?.deselect(),
      }),
    [],
  );
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          void showEntryContextMenuRef.current(item, context);
        },
      },
    },
    dragAndDrop: {
      canDrag: (paths) => paths.length === 1,
      canDrop: (event) => {
        const target = event.target;
        if (target.kind !== "directory" || target.directoryPath === null) {
          return false;
        }
        const dragged = normalizeEntryPath(event.draggedPaths[0] ?? "");
        const targetPath = normalizeEntryPath(target.directoryPath);
        return dragged !== targetPath && !targetPath.startsWith(`${dragged}/`);
      },
      onDropError: (error) =>
        toastManager.add({ type: "error", title: "Move failed", description: error }),
    },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: T3_PIERRE_ICONS,
    renaming: {
      onError: (error) =>
        toastManager.add({ type: "error", title: "Rename failed", description: error }),
    },
    onSelectionChange: (selectedPaths) => {
      dragMention.handleSelectionChange(selectedPaths);
      // Starting a drag selects the dragged row; that selection is a side
      // effect of the gesture, not a request to open the file.
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        onOpenFile(selectedPath);
      }
    },
    paths: [],
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
  });
  const search = useFileTreeSearch(model);
  const handleSearchValueChange = (value: string) => {
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
    setAllDirectoriesExpanded(false);
  }, [entryKinds, model, treePaths]);

  const startCreateEntry = (parentPath: string, kind: "file" | "directory") => {
    const baseName = kind === "directory" ? "untitled folder" : "untitled";
    const existingPaths = new Set<string>([
      ...entries.map((entry) => entry.path),
      ...pendingCreatesRef.current.keys(),
    ]);
    let name = baseName;
    let index = 2;
    while (existingPaths.has(parentPath ? `${parentPath}/${name}` : name)) {
      name = `${baseName} ${index}`;
      index += 1;
    }
    const placeholderPath = parentPath ? `${parentPath}/${name}` : name;
    const canonicalPath = canonicalTreePath(placeholderPath, kind);
    void (async () => {
      const result = await createEntry({
        environmentId,
        input: { cwd, relativePath: placeholderPath, kind },
      });
      if (result._tag !== "Success") {
        toastManager.add({
          type: "error",
          title: kind === "directory" ? "Failed to create folder" : "Failed to create file",
          description: commandErrorMessage(result),
        });
        return;
      }
      try {
        model.add(canonicalPath);
      } catch (error) {
        void deleteEntry({ environmentId, input: { cwd, relativePath: placeholderPath } });
        toastManager.add({
          type: "error",
          title: "Failed to create entry",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return;
      }
      if (model.getItem(canonicalPath) === null) {
        void deleteEntry({ environmentId, input: { cwd, relativePath: placeholderPath } });
        toastManager.add({
          type: "error",
          title: "Failed to create entry",
          description: "The parent folder is no longer available.",
        });
        return;
      }
      pendingCreatesRef.current.set(placeholderPath, kind);
      model.startRenaming(canonicalPath, { removeIfCanceled: true });
    })();
  };

  const startRenameEntry = (relativePath: string) => {
    const kind = entryKinds.get(relativePath);
    model.startRenaming(
      canonicalTreePath(relativePath, kind === "directory" ? "directory" : "file"),
    );
  };

  const showCreateAtRootMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const api = readLocalApi();
    if (!api) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const clicked = await api.contextMenu.show(
      [
        { id: "new-file", label: "New file" },
        { id: "new-folder", label: "New folder" },
      ],
      { x: rect.left, y: rect.bottom },
    );
    if (clicked === "new-file") {
      startCreateEntry("", "file");
    } else if (clicked === "new-folder") {
      startCreateEntry("", "directory");
    }
  };

  const confirmDeleteEntry = async (relativePath: string, kind: "file" | "directory") => {
    const label = kind === "directory" ? "folder" : "file";
    const confirmed = window.confirm(`Delete ${label} '${relativePath}'? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    const result = await deleteEntry({ environmentId, input: { cwd, relativePath } });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: `Failed to delete ${label}`,
        description: commandErrorMessage(result),
      });
      return;
    }
    entriesQuery.refresh();
  };

  useEffect(() => {
    const unsubscribeMove = model.onMutation("move", (event) => {
      const from = normalizeEntryPath(event.from);
      const to = normalizeEntryPath(event.to);
      void (async () => {
        const result = await renameEntry({
          environmentId,
          input: { cwd, sourcePath: from, targetPath: to },
        });
        if (result._tag !== "Success") {
          toastManager.add({
            type: "error",
            title: "Failed to rename",
            description: commandErrorMessage(result),
          });
          model.resetPaths(treePaths);
          return;
        }
        pendingCreatesRef.current.delete(from);
        entriesQuery.refresh();
      })();
    });
    const unsubscribeRemove = model.onMutation("remove", (event) => {
      const removedPath = normalizeEntryPath(event.path);
      if (pendingCreatesRef.current.delete(removedPath)) {
        void deleteEntry({ environmentId, input: { cwd, relativePath: removedPath } });
      }
    });
    return () => {
      unsubscribeMove();
      unsubscribeRemove();
    };
  }, [cwd, deleteEntry, entriesQuery.refresh, environmentId, model, renameEntry, treePaths]);

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );
  const [allDirectoriesExpanded, setAllDirectoriesExpanded] = useState(false);

  const toggleAllDirectories = () => {
    const nextExpanded = !allDirectoriesExpanded;
    for (const entry of entries) {
      if (entry.kind !== "directory") {
        continue;
      }
      const item = model.getItem(entry.path);
      if (item === null) {
        continue;
      }
      if (!nextExpanded && "collapse" in item) {
        item.collapse();
      } else if (nextExpanded && "expand" in item) {
        item.expand();
      }
    }
    setAllDirectoriesExpanded(nextExpanded);
  };

  // Tag tree drags with the composer mention payload. The row is read from
  // the composed event path (the tree's shadow root is open), so this does
  // not depend on running after the tree's own dragstart handler; the drag
  // data store is writable for every dragstart listener in the dispatch.
  // The capture phase runs before the tree's own dragstart handler selects
  // the dragged row, so the drag flag is up before that selection emits.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const handleDragStart = (event: DragEvent) => dragMention.handleDragStart(event);
    const handleDragEnd = () => dragMention.handleDragEnd();
    panel.addEventListener("dragstart", handleDragStart, true);
    panel.addEventListener("dragend", handleDragEnd);
    return () => {
      panel.removeEventListener("dragstart", handleDragStart, true);
      panel.removeEventListener("dragend", handleDragEnd);
    };
  }, [dragMention]);

  return (
    <div
      ref={panelRef}
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="surface-subheader gap-1 px-2" data-surface-subheader>
        <RefreshFilesButton isPending={entriesQuery.isPending} onRefresh={entriesQuery.refresh} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Create file or folder in project root"
                onClick={(event) => void showCreateAtRootMenu(event)}
              />
            }
          >
            <Plus className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Create file or folder in project root</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
                onClick={toggleAllDirectories}
              />
            }
          >
            {allDirectoriesExpanded ? (
              <ChevronsDownUpIcon className="size-3.5" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">
            {allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
          </TooltipPopup>
        </Tooltip>
        <FileSearchField
          name="project-files-search"
          ariaLabel={`Search ${projectName} files`}
          value={search.value}
          onValueChange={handleSearchValueChange}
          onClose={search.close}
        />
        <div className="shrink-0 truncate text-[10px] text-muted-foreground">
          {entriesQuery.isPending && entriesQuery.data === null
            ? "Indexing…"
            : `${fileCount.toLocaleString()} files`}
          {entriesQuery.data?.truncated ? " · partial" : ""}
        </div>
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            colorScheme: resolvedTheme,
            ["--trees-fg-override" as string]: "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}
