import { BoardDocument, createEmptyBoardDocument, isBoardDocument } from "./board-document";

export type LocalProject = {
  id: string;
  name: string;
  document: BoardDocument;
  updatedAt: string;
};

export type ProjectLibrary = {
  version: 1;
  projects: LocalProject[];
  activeProjectId: string;
};

export type ProjectStorageMode = "indexeddb" | "localstorage";
export type LoadedProjectLibrary = {
  library: ProjectLibrary;
  storageMode: ProjectStorageMode;
  warning: string;
};

export type ProjectFile = {
  format: "fbd-whiteboard-project";
  version: 1;
  exportedAt: string;
  project: {
    name: string;
    document: BoardDocument;
  };
};

const databaseName = "fbd-whiteboard-projects";
const databaseVersion = 1;
const objectStoreName = "library";
const libraryKey = "all-projects";
const localStorageKey = "fbd-project-library-v1";
const maximumProjectFileBytes = 5_000_000;

function isLocalProject(value: unknown): value is LocalProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<LocalProject>;
  return typeof project.id === "string"
    && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(project.id)
    && typeof project.name === "string"
    && project.name.trim().length > 0
    && project.name.length <= 80
    && typeof project.updatedAt === "string"
    && Number.isFinite(Date.parse(project.updatedAt))
    && isBoardDocument(project.document);
}

export function isProjectLibrary(value: unknown): value is ProjectLibrary {
  if (!value || typeof value !== "object") return false;
  const library = value as Partial<ProjectLibrary>;
  return library.version === 1
    && Array.isArray(library.projects)
    && library.projects.length <= 500
    && library.projects.every(isLocalProject)
    && new Set(library.projects.map((project) => project.id)).size === library.projects.length
    && typeof library.activeProjectId === "string"
    && library.projects.some((project) => project.id === library.activeProjectId);
}

export function createProjectFile(name: string, document: BoardDocument, exportedAt = new Date()): ProjectFile {
  return {
    format: "fbd-whiteboard-project",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    project: { name: name.trim(), document },
  };
}

export function parseProjectFile(contents: string): ProjectFile {
  if (new TextEncoder().encode(contents).length > maximumProjectFileBytes) {
    throw new Error("This project file is too large to import (maximum 5 MB).");
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("This file is not valid project JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("This file is not a supported FBD project.");
  const file = value as Partial<ProjectFile>;
  if (file.format !== "fbd-whiteboard-project") throw new Error("This file is not an FBD Whiteboard project.");
  if (file.version !== 1) throw new Error(`This project uses unsupported file version ${String(file.version)}.`);
  if (typeof file.exportedAt !== "string" || !Number.isFinite(Date.parse(file.exportedAt))) {
    throw new Error("The project file has an invalid export date.");
  }
  if (!file.project || typeof file.project !== "object") throw new Error("This project file is missing its project data.");
  const project = file.project as ProjectFile["project"];
  if (typeof project.name !== "string" || !project.name.trim() || project.name.length > 80) {
    throw new Error("The project file has an invalid project name.");
  }
  if (!isBoardDocument(project.document)) {
    throw new Error("The project file contains invalid or unsupported board data.");
  }
  return createProjectFile(project.name, project.document, new Date());
}

export function serializeProjectFile(name: string, document: BoardDocument): string {
  if (!isBoardDocument(document)) throw new Error("This project contains invalid board data and cannot be exported.");
  const contents = JSON.stringify(createProjectFile(name, document), null, 2);
  if (new TextEncoder().encode(contents).length > maximumProjectFileBytes) {
    throw new Error("This project is too large to export (maximum 5 MB). Delete old sketch marks or shorten the equations, then try again.");
  }
  return contents;
}

function createProject(name: string, document = createEmptyBoardDocument()): LocalProject {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80) || "Untitled project",
    document,
    updatedAt: new Date().toISOString(),
  };
}

function readLegacyProjects(): { projects: LocalProject[]; warning: string } {
  const projects: LocalProject[] = [];
  let capped = false;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (projects.length >= 500) {
        capped = true;
        break;
      }
      const key = window.localStorage.key(index);
      if (!key || !/^fbd-board-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(key)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const document: unknown = JSON.parse(raw);
        if (!isBoardDocument(document)) continue;
        const roomId = key.slice("fbd-board-".length);
        projects.push(createProject(`Recovered board ${roomId.slice(0, 8)}`, document));
      } catch {
        continue;
      }
    }
  } catch {
    return { projects: [], warning: "Existing browser-cached boards could not be migrated from localStorage." };
  }
  return {
    projects,
    warning: capped ? "Only the first 500 locally cached boards could be migrated." : "",
  };
}

function createInitialLibrary(): { library: ProjectLibrary; warning: string } {
  const migration = readLegacyProjects();
  const projects = migration.projects;
  if (projects.length === 0) projects.push(createProject("Untitled project"));
  return { library: { version: 1, projects, activeProjectId: projects[0].id }, warning: migration.warning };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(new Error("IndexedDB could not be opened."));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("Project storage is blocked by another open app tab."));
    };
  });
}

function readIndexedLibrary(database: IDBDatabase): Promise<ProjectLibrary | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, "readonly");
    const request = transaction.objectStore(objectStoreName).get(libraryKey);
    let result: unknown;
    request.onsuccess = () => { result = request.result?.value; };
    request.onerror = () => reject(new Error("Saved projects could not be read from IndexedDB."));
    transaction.oncomplete = () => {
      if (result === undefined) {
        resolve(null);
      } else if (isProjectLibrary(result)) {
        resolve(result);
      } else {
        reject(new Error("Local project storage is damaged and was not overwritten. To use a backup, clear this site's browser data and reload before importing."));
      }
    };
    transaction.onerror = () => reject(new Error("Saved projects could not be read from IndexedDB."));
    transaction.onabort = () => reject(new Error("Reading saved projects was interrupted."));
  });
}

function writeIndexedLibrary(database: IDBDatabase, library: ProjectLibrary): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, "readwrite");
    transaction.objectStore(objectStoreName).put({ key: libraryKey, value: library });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("Projects could not be saved to IndexedDB."));
    transaction.onabort = () => reject(new Error("Saving projects to IndexedDB was interrupted."));
  });
}

function updateIndexedLibrary(
  database: IDBDatabase,
  update: (library: ProjectLibrary) => ProjectLibrary,
): Promise<ProjectLibrary> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(objectStoreName, "readwrite");
    const store = transaction.objectStore(objectStoreName);
    const request = store.get(libraryKey);
    let updated: ProjectLibrary | undefined;
    request.onsuccess = () => {
      if (!isProjectLibrary(request.result?.value)) {
        transaction.abort();
        reject(new Error("Project storage is missing or invalid."));
        return;
      }
      try {
        updated = update(request.result.value);
        store.put({ key: libraryKey, value: updated });
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(new Error("Saved projects could not be updated."));
    transaction.oncomplete = () => {
      if (updated) resolve(updated);
      else reject(new Error("Project storage update did not complete."));
    };
    transaction.onerror = () => reject(new Error("Projects could not be saved to IndexedDB."));
    transaction.onabort = () => reject(new Error("Saving projects to IndexedDB was interrupted."));
  });
}

function readLocalLibrary(): ProjectLibrary | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(localStorageKey);
  } catch {
    throw new Error("Local browser storage could not be read.");
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isProjectLibrary(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Local project storage is damaged and was not overwritten. To use a backup, clear this site's browser data and reload before importing.");
  }
}

function writeLocalLibrary(library: ProjectLibrary): void {
  try {
    window.localStorage.setItem(localStorageKey, JSON.stringify(library));
  } catch {
    throw new Error("Projects could not be saved. Browser storage may be full or disabled; export a backup before continuing.");
  }
}

export async function loadProjectLibrary(): Promise<LoadedProjectLibrary> {
  if ("indexedDB" in window) {
    let database: IDBDatabase | undefined;
    try {
      database = await openDatabase();
      const existing = await readIndexedLibrary(database);
      let localFallback: ProjectLibrary | null;
      let fallbackWarning = "";
      try {
        localFallback = readLocalLibrary();
      } catch (error) {
        localFallback = null;
        fallbackWarning = error instanceof Error ? ` ${error.message}` : " Local browser storage could not be read.";
      }
      if (existing || localFallback) {
        if (!existing && localFallback) {
          await writeIndexedLibrary(database, localFallback);
          return { library: localFallback, storageMode: "indexeddb", warning: "" };
        }
        if (!existing) throw new Error("Project storage could not be initialized.");
        if (localFallback) {
          const projectsById = new Map(existing.projects.map((project) => [project.id, project]));
          for (const project of localFallback.projects) {
            const indexedProject = projectsById.get(project.id);
            if (!indexedProject || Date.parse(project.updatedAt) > Date.parse(indexedProject.updatedAt)) {
              projectsById.set(project.id, project);
            }
          }
          const projects = [...projectsById.values()];
          const activeProjectId = projects.some((project) => project.id === localFallback.activeProjectId)
            ? localFallback.activeProjectId
            : existing.activeProjectId;
          const merged = { version: 1 as const, projects, activeProjectId };
          if (JSON.stringify(merged) !== JSON.stringify(existing)) await writeIndexedLibrary(database, merged);
          return { library: merged, storageMode: "indexeddb", warning: fallbackWarning };
        }
        return { library: existing, storageMode: "indexeddb", warning: fallbackWarning };
      }
      const initial = createInitialLibrary();
      await writeIndexedLibrary(database, initial.library);
      return { library: initial.library, storageMode: "indexeddb", warning: `${fallbackWarning}${initial.warning}` };
    } catch (error) {
      database?.close();
      if (error instanceof Error && error.message.includes("Local project storage is damaged")) throw error;
      const warning = error instanceof Error ? error.message : "IndexedDB is unavailable.";
      const fallback = readLocalLibrary();
      if (fallback) return { library: fallback, storageMode: "localstorage", warning: `${warning} Using local browser storage instead.` };
      const initial = createInitialLibrary();
      writeLocalLibrary(initial.library);
      return { library: initial.library, storageMode: "localstorage", warning: `${warning} Using local browser storage instead. ${initial.warning}` };
    }
  }
  const existing = readLocalLibrary();
  if (existing) return { library: existing, storageMode: "localstorage", warning: "IndexedDB is unavailable; projects are saved in local browser storage." };
  const initial = createInitialLibrary();
  writeLocalLibrary(initial.library);
  return {
    library: initial.library,
    storageMode: "localstorage",
    warning: `IndexedDB is unavailable; projects are saved in local browser storage. ${initial.warning}`,
  };
}

async function updateLibrary(
  mode: ProjectStorageMode,
  update: (library: ProjectLibrary) => ProjectLibrary,
): Promise<ProjectLibrary> {
  if (mode === "localstorage") {
    const current = readLocalLibrary();
    if (!current) throw new Error("Local project storage has not been initialized.");
    const next = update(current);
    writeLocalLibrary(next);
    return next;
  }
  const database = await openDatabase();
  try {
    return await updateIndexedLibrary(database, update);
  } finally {
    database.close();
  }
}

export function createLocalProject(
  mode: ProjectStorageMode,
  name: string,
  document: BoardDocument,
): Promise<ProjectLibrary> {
  return updateLibrary(mode, (library) => {
    if (library.projects.length >= 500) throw new Error("This device already has 500 projects. Delete an unused project before creating another.");
    const project = createProject(name, document);
    return { ...library, projects: [...library.projects, project], activeProjectId: project.id };
  });
}

export function saveLocalProject(
  mode: ProjectStorageMode,
  id: string,
  document: BoardDocument,
): Promise<ProjectLibrary> {
  return updateLibrary(mode, (library) => {
    const projects = library.projects.map((project) =>
      project.id === id ? { ...project, document, updatedAt: new Date().toISOString() } : project,
    );
    if (!projects.some((project) => project.id === id)) throw new Error("The active project no longer exists on this device.");
    return { ...library, projects };
  });
}

export function renameLocalProject(mode: ProjectStorageMode, id: string, name: string): Promise<ProjectLibrary> {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 80) throw new Error("Project names must contain 1 to 80 characters.");
  return updateLibrary(mode, (library) => {
    const projects = library.projects.map((project) =>
      project.id === id ? { ...project, name: trimmedName, updatedAt: new Date().toISOString() } : project,
    );
    if (!projects.some((project) => project.id === id)) throw new Error("That project no longer exists on this device.");
    return { ...library, projects };
  });
}

export function activateLocalProject(mode: ProjectStorageMode, id: string): Promise<ProjectLibrary> {
  return updateLibrary(mode, (library) => {
    if (!library.projects.some((project) => project.id === id)) throw new Error("That project no longer exists on this device.");
    return { ...library, activeProjectId: id };
  });
}

export function deleteLocalProject(mode: ProjectStorageMode, id: string): Promise<ProjectLibrary> {
  return updateLibrary(mode, (library) => {
    const projects = library.projects.filter((project) => project.id !== id);
    if (projects.length === library.projects.length) throw new Error("That project no longer exists on this device.");
    if (projects.length === 0) {
      const replacement = createProject("Untitled project");
      return { version: 1, projects: [replacement], activeProjectId: replacement.id };
    }
    return {
      ...library,
      projects,
      activeProjectId: library.activeProjectId === id ? projects[0].id : library.activeProjectId,
    };
  });
}
