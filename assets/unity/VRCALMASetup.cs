// VRCAL owned, opt-in Editor helper. GPL-3.0-only. No runtime assembly dependencies on MA or VRChat.
// Scene instances only: never saves scenes, prefab assets, expression menus, or expression parameters.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object = UnityEngine.Object;

namespace VRCAL.LocalAssets
{
    [InitializeOnLoad]
    public static class VRCALMASetup
    {
        [Serializable] internal sealed class Request
        {
            public int schema;
            public string id, sha256, projectPath, sourceName, mode, sourcePackageName;
            public string[] prefabPaths;
            public bool assemble;
        }
        [Serializable] private sealed class Receipt
        {
            public int schema = 1;
            public string id, sha256, state, message, avatarName, prefabPath, menuName;
            public string hierarchyPath;
            public bool assembly;
            public string[] importedAssetPaths;
            public bool importedPathsComplete;
        }
        private sealed class PrefabBatch
        {
            public bool known, complete;
            public string[] paths = new string[0];
        }
        [Serializable] private sealed class Journal
        {
            public int schema = 1;
            public string id, sha256, phase;
            public bool importedKnown;
            public string[] prefabPaths = new string[0];
        }
        [Serializable] private sealed class ImportIdentity
        {
            public int schema;
            public string id, sha256, sourcePath, projectPath;
        }

        private const string Prefix = "nadena.dev.modular_avatar.core.";
        private const string AvatarTypeName = "VRC.SDK3.Avatars.Components.VRCAvatarDescriptor";
        private const string PackageSession = "VRCAL.MA.Package.v1";
        private static readonly string Project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
        private static readonly string Root = Path.Combine(Project, "Library", "VRCALImportBridge");
        private static readonly Regex IdPattern = new Regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", RegexOptions.IgnoreCase);
        private static readonly Regex HashPattern = new Regex("^[a-f0-9]{64}$", RegexOptions.IgnoreCase);
        private static readonly List<Request> Pending = new List<Request>();
        private static Request packageRequest;
        private static string observedPackage;
        private static double nextPoll;
        private static string lastWarning;

        static VRCALMASetup()
        {
            AssetDatabase.importPackageStarted += PackageStarted;
            AssetDatabase.onImportPackageItemsCompleted += PackageItems;
            AssetDatabase.importPackageCompleted += PackageEnded;
            AssetDatabase.importPackageCancelled += PackageEnded;
            AssetDatabase.importPackageFailed += PackageFailed;
            EditorApplication.update += Poll;
            try
            {
                string saved = SessionState.GetString(PackageSession, "");
                if (!String.IsNullOrEmpty(saved))
                {
                    Request candidate = JsonUtility.FromJson<Request>(saved);
                    if (Valid(candidate) && BridgeOwns(candidate))
                    {
                        packageRequest = candidate;
                        observedPackage = Path.GetFileNameWithoutExtension(candidate.sourcePackageName);
                    }
                }
            }
            catch (Exception exception) { Warn(exception); }
        }

        [MenuItem("Tools/VRC Asset Library/Configure imported MA menu")]
        [MenuItem("Tools/VRC Asset Library/Assemble imported Prefab")]
        [MenuItem("Tools/VRC 素材库/装配导入的预制件")]
        private static void OpenWindow()
        {
            RefreshRequests();
            SetupWindow.Open();
        }

        private static void Poll()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode
                || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1;
            try { RefreshRequests(); if (!Application.isBatchMode) ProcessAssemblyRequests(); }
            catch (Exception exception) { Warn(exception); }
        }

        private static void Warn(Exception exception)
        {
            string message = "VRCAL MA: " + exception.Message;
            if (lastWarning != message) Debug.LogWarning(message);
            lastWarning = message;
        }

        private static void NoLinks(string path)
        {
            for (string cursor = Path.GetFullPath(path); !String.IsNullOrEmpty(cursor); cursor = Path.GetDirectoryName(cursor))
                if ((File.Exists(cursor) || Directory.Exists(cursor)) && (File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Linked project paths are not supported by VRCAL MA.");
        }

        private static bool ValidPrefabPath(string path)
        {
            if (String.IsNullOrEmpty(path) || path.Length > 2000 || !path.StartsWith("Assets/", StringComparison.Ordinal)
                || !path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase) || path.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0) return false;
            string[] parts = path.Split('/');
            if (parts.Any(p => p.Length == 0 || p == "." || p == "..")) return false;
            string full = Path.GetFullPath(Path.Combine(Project, path));
            return full.StartsWith(Path.Combine(Project, "Assets") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        private static bool Valid(Request request)
        {
            try
            {
                return request != null && request.schema == 1 && request.id != null && IdPattern.IsMatch(request.id)
                    && request.sha256 != null && HashPattern.IsMatch(request.sha256)
                    && !String.IsNullOrEmpty(request.projectPath) && Path.IsPathRooted(request.projectPath)
                    && String.Equals(Path.GetFullPath(request.projectPath), Project, StringComparison.OrdinalIgnoreCase)
                    && (request.mode == "copy" || request.mode == "unitypackage")
                    && request.sourceName != null && request.sourceName.Length <= 1000
                    && request.prefabPaths != null && request.prefabPaths.Length <= 1000 && request.prefabPaths.All(ValidPrefabPath)
                    && (request.mode != "unitypackage" || (!String.IsNullOrEmpty(request.sourcePackageName)
                        && request.sourcePackageName == Path.GetFileName(request.sourcePackageName)
                        && request.sourcePackageName.IndexOfAny(new[] { '/', '\\', ':', '\0' }) < 0
                        && request.sourcePackageName.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase)));
            }
            catch { return false; }
        }

        private static T Read<T>(string path) where T : class
        {
            NoLinks(path);
            if (!File.Exists(path)) return null;
            if (new FileInfo(path).Length > 1024 * 1024) throw new IOException("VRCAL MA metadata is too large.");
            return JsonUtility.FromJson<T>(File.ReadAllText(path, Encoding.UTF8));
        }

        private static string MetadataPath(string directory, string id)
        {
            return Path.Combine(Root, directory, id + ".json");
        }

        private static void AtomicWrite(string path, object value)
        {
            NoLinks(path);
            string directory = Path.GetDirectoryName(path);
            Directory.CreateDirectory(directory);
            // Keep the temporary basename shorter than the UUID receipt (Unity Mono still has path length limits).
            string temporary = Path.Combine(directory, ".ma-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    byte[] bytes = new UTF8Encoding(false).GetBytes(JsonUtility.ToJson(value));
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                NoLinks(path);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static bool SameIdentity(Request request, Receipt receipt)
        {
            return receipt != null && receipt.schema == 1 && receipt.id == request.id
                && String.Equals(receipt.sha256, request.sha256, StringComparison.OrdinalIgnoreCase);
        }
        private static bool Terminal(Receipt receipt)
        {
            return receipt != null && (receipt.state == "applied" || receipt.state == "skipped" || receipt.state == "error");
        }
        private static Receipt CurrentReceipt(Request request)
        {
            Receipt receipt = Read<Receipt>(MetadataPath("MAResults", request.id));
            if (receipt != null && !SameIdentity(request, receipt)) throw new IOException("MA receipt identity conflicts with the request. No changes were made.");
            return receipt;
        }
        private static void WriteReceipt(Request request, string state, string message, GameObject avatar = null, string prefab = null, string menu = null, GameObject instance = null)
        {
            AtomicWrite(MetadataPath("MAResults", request.id), new Receipt
            {
                id = request.id, sha256 = request.sha256, state = state, message = message,
                avatarName = avatar == null ? null : avatar.name, prefabPath = prefab, menuName = menu,
                assembly = request.assemble,
                hierarchyPath = instance == null || avatar == null ? null : avatar.name + "/" + instance.name
            });
        }
        private static Journal CurrentJournal(Request request)
        {
            Journal journal = Read<Journal>(MetadataPath("MAState", request.id));
            if (journal != null && (journal.schema != 1 || journal.id != request.id
                || !String.Equals(journal.sha256, request.sha256, StringComparison.OrdinalIgnoreCase)
                || journal.prefabPaths == null || !journal.prefabPaths.All(ValidPrefabPath)))
                throw new IOException("MA recovery metadata conflicts with the request.");
            return journal ?? new Journal { id = request.id, sha256 = request.sha256, phase = "selection" };
        }
        private static bool Imported(Request request)
        {
            if (request.mode == "copy") return true;
            Receipt receipt = Read<Receipt>(MetadataPath("Results", request.id));
            return SameIdentity(request, receipt) && receipt.state == "completed";
        }

        private static void RefreshRequests()
        {
            Pending.Clear();
            string directory = Path.Combine(Root, "MARequests");
            NoLinks(directory);
            if (!Directory.Exists(directory)) return;
            foreach (string file in Directory.GetFiles(directory, "*.json").OrderBy(p => p, StringComparer.Ordinal))
            {
                try
                {
                    Request request = Read<Request>(file);
                    if (!Valid(request) || !String.Equals(Path.GetFileNameWithoutExtension(file), request.id, StringComparison.OrdinalIgnoreCase))
                        throw new IOException("Invalid MA request or request for a different project; ignored.");
                    Receipt receipt = CurrentReceipt(request);
                    if (Terminal(receipt)) continue;
                    if (request.mode == "unitypackage")
                    {
                        Receipt importReceipt = Read<Receipt>(MetadataPath("Results", request.id));
                        ImportIdentity cancellation = Read<ImportIdentity>(MetadataPath("Requests", request.id) + ".cancelled");
                        bool cancelled = SameIdentity(request, importReceipt) && importReceipt.state == "cancelled"
                            || cancellation != null && cancellation.schema == 1 && cancellation.id == request.id
                            && String.Equals(cancellation.sha256, request.sha256, StringComparison.OrdinalIgnoreCase)
                            && String.Equals(cancellation.projectPath, request.projectPath, StringComparison.OrdinalIgnoreCase);
                        if (cancelled || SameIdentity(request, importReceipt) && importReceipt.state == "failed")
                        {
                            WriteReceipt(request, cancelled ? "skipped" : "error", cancelled
                                ? "Package import was cancelled. MA setup was skipped; imported files were not changed."
                                : "Package import failed. MA setup was not applied; inspect the separate import result.");
                            continue;
                        }
                    }
                    Journal journal = CurrentJournal(request);
                    if (journal.phase == "applying")
                    {
                        WriteReceipt(request, "error", "Unity stopped during MA setup. Inspect the scene and Undo history before starting a new request; automatic reapplication is disabled.");
                        continue;
                    }
                    bool imported = Imported(request);
                    string state = imported ? "waiting-selection" : "waiting-import";
                    string message = imported ? (request.assemble ? AssemblySelectionStatus(request) : DependencyStatus()) : "Waiting for the matching Unity package import to complete.";
                    if (imported && String.IsNullOrEmpty(message)) message = "Choose a loaded avatar and Prefab, then apply. Scene changes are not saved automatically.";
                    if (receipt == null || receipt.state != state || receipt.message != message) WriteReceipt(request, state, message);
                    Pending.Add(request);
                    string announced = "VRCAL.MA.Announced." + request.id;
                    if (imported && !Application.isBatchMode && !SessionState.GetBool(announced, false)
                        && (!request.assemble || !CanAutoAssemble(request)))
                    {
                        SessionState.SetBool(announced, true);
                        EditorApplication.delayCall += SetupWindow.Open;
                    }
                }
                catch (Exception exception) { Warn(exception); }
            }
        }

        private static Type FindType(string name)
        {
            foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type type = assembly.GetType(name, false);
                if (type != null) return type;
            }
            return null;
        }

        private static string DependencyStatus()
        {
            if (FindType(AvatarTypeName) == null) return "VRChat Avatars SDK is missing. Install a compatible SDK yourself, then reopen this window.";
            if (FindType(Prefix + "ModularAvatarMenuInstaller") == null || FindType(Prefix + "ModularAvatarMenuItem") == null
                || FindType(Prefix + "ModularAvatarObjectToggle") == null || FindType(Prefix + "AvatarObjectReference") == null)
                return "Modular Avatar menu components are missing or incompatible. Install a compatible Modular Avatar version yourself.";
            return "";
        }

        private static MethodInfo SetupOutfitMethod()
        {
            Type type = FindType(Prefix + "editor.SetupOutfit");
            MethodInfo method = type == null ? null : type.GetMethod("SetupOutfitUI", BindingFlags.Public | BindingFlags.Static,
                null, new[] { typeof(GameObject) }, null);
            return method != null && method.ReturnType == typeof(void) ? method : null;
        }

        private static string AssemblyDependencyStatus()
        {
            if (FindType(AvatarTypeName) == null) return "VRChat Avatars SDK is missing. Install a compatible SDK yourself, then reopen this window.";
            if (FindType(Prefix + "ModularAvatarMergeArmature") == null || FindType(Prefix + "ModularAvatarBoneProxy") == null
                || FindType(Prefix + "AvatarObjectReference") == null)
                return "Modular Avatar assembly components are missing. Install a compatible Modular Avatar version yourself.";
            if (SetupOutfitMethod() == null) return "The public MA Setup Outfit Editor API is unavailable. Check the installed MA version and Unity compilation errors.";
            return "";
        }

        private static bool IsSceneAvatar(GameObject avatar)
        {
            Type descriptor = FindType(AvatarTypeName);
            return descriptor != null && avatar != null && !EditorUtility.IsPersistent(avatar) && avatar.scene.IsValid()
                && avatar.scene.isLoaded && !EditorSceneManager.IsPreviewScene(avatar.scene)
                && PrefabStageUtility.GetPrefabStage(avatar) == null && avatar.GetComponent(descriptor) != null;
        }

        private static GameObject[] AvatarChoices()
        {
            Type descriptor = FindType(AvatarTypeName);
            return descriptor == null ? new GameObject[0] : Resources.FindObjectsOfTypeAll(descriptor).OfType<Component>()
                .Select(c => c.gameObject).Where(IsSceneAvatar).Distinct().OrderBy(g => g.name, StringComparer.Ordinal).ToArray();
        }

        private static bool CanAutoAssemble(Request request)
        {
            if (!request.assemble || !Imported(request) || !String.IsNullOrEmpty(AssemblyDependencyStatus()) || AvatarChoices().Length != 1) return false;
            PrefabBatch batch = ImportedPrefabBatch(request);
            return batch.known && batch.complete && batch.paths.Length == 1 && PrefabChoices(request).Length == 1;
        }

        private static string AssemblySelectionStatus(Request request)
        {
            string missing = AssemblyDependencyStatus();
            if (!String.IsNullOrEmpty(missing)) return missing;
            GameObject[] avatars = AvatarChoices();
            if (avatars.Length == 0) return "Waiting for a VRChat avatar in an open scene. Open the intended avatar scene, then refresh.";
            if (avatars.Length > 1) return "Several avatars are loaded. Choose the intended avatar and imported Prefab before assembly.";
            PrefabBatch batch = ImportedPrefabBatch(request);
            if (batch.known && !batch.complete) return "Unity reported only part of the imported paths. Choose a reported Prefab explicitly; automatic assembly is disabled.";
            string[] choices = PrefabChoices(request);
            if (choices.Length != 1 || !CanAutoAssemble(request))
                return "Choose the intended imported Prefab before assembly. No scene changes have been made.";
            return "One avatar and one imported Prefab are available. MA assembly will run automatically; one Undo removes it. Save the scene yourself after checking it.";
        }

        // Batch acceptance calls this explicitly. Normal Editor polling runs it after reading pending requests.
        private static void ProcessAssemblyRequests()
        {
            foreach (Request request in Pending.ToArray())
            {
                if (!CanAutoAssemble(request)) continue;
                try { ApplyAssembly(request, AvatarChoices()[0], AssetDatabase.LoadAssetAtPath<GameObject>(PrefabChoices(request)[0])); }
                catch (Exception exception) { Warn(exception); }
            }
        }

        private static string BindingStatus(GameObject instance, GameObject avatar)
        {
            bool found = false;
            foreach (string name in new[] { "ModularAvatarMergeArmature", "ModularAvatarBoneProxy" })
            {
                Type type = FindType(Prefix + name);
                if (type == null) continue;
                foreach (Component component in instance.GetComponentsInChildren(type, true))
                {
                    Behaviour behaviour = component as Behaviour;
                    if (behaviour != null && !behaviour.enabled) continue;
                    object target = GetMember(component, name == "ModularAvatarMergeArmature" ? "mergeTargetObject" : "target");
                    Transform transform = target is GameObject ? ((GameObject)target).transform : target as Transform;
                    if (transform == null || transform.gameObject.scene != avatar.scene
                        || !(transform == avatar.transform || transform.IsChildOf(avatar.transform)) || transform.IsChildOf(instance.transform))
                        return "MA binding on '" + component.gameObject.name + "' does not resolve to the selected avatar. Check its Merge Armature or Bone Proxy target.";
                    found = true;
                }
            }
            return found ? "" : "This Prefab has no verified MA armature or Bone Proxy binding to the selected avatar.";
        }

        private static bool HasOutfitSkeleton(GameObject instance)
        {
            return instance.GetComponentsInChildren<SkinnedMeshRenderer>(true).Any(r => r.bones != null && r.bones.Length > 0)
                || instance.GetComponentsInChildren<Animator>(true).Any(a => a.avatar != null && a.avatar.isHuman)
                || instance.GetComponentsInChildren<Transform>(true).Any(t => t != instance.transform
                    && (String.Equals(t.name, "Hips", StringComparison.OrdinalIgnoreCase) || String.Equals(t.name, "pelvis", StringComparison.OrdinalIgnoreCase)));
        }

        private static void ApplyAssembly(Request request, GameObject avatar, GameObject prefab)
        {
            if (!Valid(request) || !request.assemble) throw new InvalidOperationException("The MA assembly request is invalid.");
            if (Terminal(CurrentReceipt(request))) return;
            if (!Imported(request)) throw new InvalidOperationException("The matching package import has not completed.");
            string dependency = AssemblyDependencyStatus();
            if (!String.IsNullOrEmpty(dependency)) throw new InvalidOperationException(dependency);
            if (!IsSceneAvatar(avatar)) throw new InvalidOperationException("Choose a VRChat avatar root in an open scene.");
            string prefabPath = AssetDatabase.GetAssetPath(prefab);
            if (prefab == null || !EditorUtility.IsPersistent(prefab) || !ValidPrefabPath(prefabPath)
                || PrefabUtility.GetPrefabAssetType(prefab) == PrefabAssetType.NotAPrefab
                || AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath) != prefab)
                throw new InvalidOperationException("Choose a Prefab asset under Assets/.");
            NoLinks(Path.Combine(Project, prefabPath));
            Journal journal = CurrentJournal(request);
            if (ImportedPrefabBatch(request).known
                && !PrefabChoices(request).Contains(prefabPath, StringComparer.Ordinal))
                throw new InvalidOperationException("Choose a Prefab from this import batch.");
            journal.phase = "applying";
            AtomicWrite(MetadataPath("MAState", request.id), journal);
            Undo.IncrementCurrentGroup();
            int undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("Assemble imported Prefab with MA");
            try
            {
                // The public MA routine can touch existing avatar properties; include those in rollback and Undo.
                Undo.RegisterFullObjectHierarchyUndo(avatar, "Assemble imported Prefab with MA");
                GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, avatar.transform);
                if (instance == null) throw new InvalidOperationException("Unity could not instantiate this Prefab.");
                Undo.RegisterCreatedObjectUndo(instance, "Assemble imported Prefab with MA");
                string binding = BindingStatus(instance, avatar);
                bool preserved = String.IsNullOrEmpty(binding);
                if (!preserved)
                {
                    if (!HasOutfitSkeleton(instance)) throw new InvalidOperationException(binding + " This is not a recognized skeletal outfit; configure its attachment explicitly in MA.");
                    SetupOutfitMethod().Invoke(null, new object[] { instance });
                    binding = BindingStatus(instance, avatar);
                    if (!String.IsNullOrEmpty(binding)) throw new InvalidOperationException("MA Setup Outfit did not establish a valid binding. " + binding);
                }
                if (instance.transform.parent != avatar.transform) throw new InvalidOperationException("MA changed the Prefab root parent unexpectedly. Assembly was rolled back.");
                Undo.RecordObject(instance.transform, "Place imported Prefab last");
                instance.transform.SetAsLastSibling();
                Undo.FlushUndoRecordObjects();
                Undo.CollapseUndoOperations(undoGroup);
                WriteReceipt(request, "applied", preserved
                    ? "Prefab assembled as the avatar's last direct child with its existing verified MA binding. Scene changes are unsaved; one Undo removes the assembly."
                    : "MA Setup Outfit completed and its binding resolves to the selected avatar. Prefab is the avatar's last direct child. Scene changes are unsaved; one Undo removes the assembly. Check fit and clipping yourself.",
                    avatar, prefabPath, null, instance);
                Selection.activeGameObject = instance;
            }
            catch (Exception exception)
            {
                Undo.RevertAllDownToGroup(undoGroup);
                journal.phase = "failed";
                Exception cause = exception is TargetInvocationException && exception.InnerException != null ? exception.InnerException : exception;
                try { AtomicWrite(MetadataPath("MAState", request.id), journal); WriteReceipt(request, "error", "MA assembly rolled back: " + cause.Message); }
                catch (Exception writeError) { Warn(writeError); }
                throw new InvalidOperationException(cause.Message, cause);
            }
            finally { Undo.IncrementCurrentGroup(); }
            RefreshRequests();
        }

        private static bool BridgeOwns(Request request)
        {
            try
            {
                ImportIdentity identity = JsonUtility.FromJson<ImportIdentity>(SessionState.GetString("VRCAL.Import.Active.v1", ""));
                return identity != null && identity.id == request.id && String.Equals(identity.sha256, request.sha256, StringComparison.OrdinalIgnoreCase)
                    && String.Equals(Path.GetFileName(identity.sourcePath), request.sourcePackageName, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }
        private static bool MatchesPackage(Request request, string name)
        {
            return !String.IsNullOrEmpty(name) && String.Equals(Path.GetFileNameWithoutExtension(name),
                Path.GetFileNameWithoutExtension(request.sourcePackageName), StringComparison.OrdinalIgnoreCase);
        }
        private static void PackageStarted(string name)
        {
            packageRequest = null;
            observedPackage = null;
            SessionState.EraseString(PackageSession);
            try
            {
                RefreshRequests();
                Request[] matches = Pending.Where(r => r.mode == "unitypackage" && MatchesPackage(r, name) && BridgeOwns(r)).ToArray();
                if (matches.Length != 1) return; // An unrelated/manual import is never associated by basename alone.
                packageRequest = matches[0];
                observedPackage = name;
                SessionState.SetString(PackageSession, JsonUtility.ToJson(packageRequest));
            }
            catch (Exception exception) { Warn(exception); }
        }
        private static void PackageItems(string[] paths)
        {
            if (packageRequest == null || !BridgeOwns(packageRequest)) return;
            try
            {
                Journal journal = CurrentJournal(packageRequest);
                journal.importedKnown = true;
                journal.prefabPaths = (paths ?? new string[0]).Where(ValidPrefabPath).Distinct(StringComparer.Ordinal).ToArray();
                AtomicWrite(MetadataPath("MAState", packageRequest.id), journal);
            }
            catch (Exception exception) { Warn(exception); }
        }
        private static void PackageEnded(string name)
        {
            if (packageRequest != null && String.Equals(observedPackage, name, StringComparison.OrdinalIgnoreCase))
            {
                packageRequest = null;
                observedPackage = null;
                SessionState.EraseString(PackageSession);
            }
        }
        private static void PackageFailed(string name, string message) { PackageEnded(name); }

        private static string[] PrefabChoices(Request request)
        {
            return ImportedPrefabBatch(request).paths.Where(p => AssetDatabase.LoadAssetAtPath<GameObject>(p) != null).ToArray();
        }
        private static bool ValidImportedPath(string path)
        {
            return !String.IsNullOrEmpty(path) && path.Length <= 32760 && path.StartsWith("Assets/", StringComparison.Ordinal)
                && path.IndexOfAny(new[] { '\\', ':' }) < 0 && !path.Any(Char.IsControl)
                && path.Split('/').All(p => p.Length > 0 && p != "." && p != ".."
                    && !p.EndsWith(".", StringComparison.Ordinal) && !p.EndsWith(" ", StringComparison.Ordinal));
        }
        private static PrefabBatch ImportedPrefabBatch(Request request)
        {
            if (request.mode == "copy") return new PrefabBatch
            {
                known = request.prefabPaths.Length > 0, complete = true,
                paths = request.prefabPaths.Distinct(StringComparer.Ordinal).ToArray()
            };
            Receipt imported = Read<Receipt>(MetadataPath("Results", request.id));
            if (SameIdentity(request, imported) && imported.state == "completed" && imported.importedAssetPaths != null
                && imported.importedAssetPaths.Length <= 10000 && imported.importedAssetPaths.All(ValidImportedPath))
            {
                string[] allPrefabs = imported.importedAssetPaths.Where(p => p.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)).ToArray();
                return new PrefabBatch
                {
                    // Unity serializes an unknown null array as []; empty plus incomplete cannot prove a batch.
                    known = imported.importedPathsComplete || imported.importedAssetPaths.Length > 0,
                    complete = imported.importedPathsComplete && allPrefabs.All(ValidPrefabPath),
                    paths = allPrefabs.Where(ValidPrefabPath).Distinct(StringComparer.Ordinal).ToArray()
                };
            }
            // Old imports may lack the new receipt fields. Event-only captures never establish a whole batch.
            // The assembly flow requires explicit choice in this case; legacy menu requests may retain their old list.
            Journal journal = CurrentJournal(request);
            return !request.assemble && journal.importedKnown
                ? new PrefabBatch { known = true, paths = journal.prefabPaths.Distinct(StringComparer.Ordinal).ToArray() }
                : new PrefabBatch();
        }
        private static object GetMember(object value, string name)
        {
            FieldInfo field = value.GetType().GetField(name);
            if (field != null) return field.GetValue(value);
            PropertyInfo property = value.GetType().GetProperty(name);
            if (property != null && property.CanRead) return property.GetValue(value, null);
            throw new InvalidOperationException("Installed MA API is incompatible: " + name);
        }
        private static void SetMember(object value, string name, object contents)
        {
            FieldInfo field = value.GetType().GetField(name);
            if (field != null) { field.SetValue(value, contents); return; }
            PropertyInfo property = value.GetType().GetProperty(name);
            if (property != null && property.CanWrite) { property.SetValue(value, contents, null); return; }
            throw new InvalidOperationException("Installed MA API is incompatible: " + name);
        }
        private static void SetEnum(object value, string member, string name)
        {
            FieldInfo field = value.GetType().GetField(member);
            PropertyInfo property = value.GetType().GetProperty(member);
            if (field == null && property == null) throw new InvalidOperationException("Installed MA API is incompatible: " + member);
            Type type = field == null ? property.PropertyType : field.FieldType;
            SetMember(value, member, Enum.Parse(type, name));
        }
        private static bool HasPreset(GameObject prefab)
        {
            Type item = FindType(Prefix + "ModularAvatarMenuItem"), installer = FindType(Prefix + "ModularAvatarMenuInstaller");
            return item != null && prefab.GetComponentsInChildren(item, true).Length != 0
                || installer != null && prefab.GetComponentsInChildren(installer, true).Length != 0;
        }

        private static void CreateToggle(GameObject group, GameObject instance, Request request, string name, bool visible)
        {
            GameObject node = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(node, "Configure imported MA menu");
            node.transform.SetParent(group.transform, false);
            Undo.AddComponent(node, FindType(Prefix + "ModularAvatarMenuInstaller"));
            Component item = Undo.AddComponent(node, FindType(Prefix + "ModularAvatarMenuItem"));
            // Legacy Control remains a public SDK field in MA 1.x, including 1.18. Fail and roll back if it changes.
            FieldInfo controlField = item.GetType().GetField("Control");
            if (controlField == null) throw new InvalidOperationException("This MA version does not expose its VRChat menu control API.");
            object control = Activator.CreateInstance(controlField.FieldType);
            SetEnum(control, "type", "Toggle");
            SetMember(control, "name", name);
            SetMember(control, "value", 1f);
            FieldInfo parameterField = control.GetType().GetField("parameter");
            if (parameterField == null) throw new InvalidOperationException("Installed SDK menu parameter API is incompatible.");
            object parameter = Activator.CreateInstance(parameterField.FieldType);
            SetMember(parameter, "name", "VRCAL_" + request.id.Replace("-", ""));
            SetMember(control, "parameter", parameter);
            SetMember(item, "Control", control);
            SetMember(item, "isDefault", visible);
            SetMember(item, "automaticValue", false);
            SetMember(item, "label", name);
            SetEnum(item, "MenuSource", "Children");
            Component toggle = Undo.AddComponent(node, FindType(Prefix + "ModularAvatarObjectToggle"));
            IList objects = GetMember(toggle, "Objects") as IList;
            if (objects == null || !objects.GetType().IsGenericType) throw new InvalidOperationException("This MA version has an incompatible Object Toggle API.");
            object entry = Activator.CreateInstance(objects.GetType().GetGenericArguments()[0]);
            object reference = Activator.CreateInstance(FindType(Prefix + "AvatarObjectReference"));
            MethodInfo set = reference.GetType().GetMethod("Set", new[] { typeof(GameObject) });
            if (set == null) throw new InvalidOperationException("This MA version cannot reference the imported instance.");
            set.Invoke(reference, new object[] { instance });
            SetMember(entry, "Object", reference);
            SetMember(entry, "Active", true);
            objects.Add(entry);
            SetMember(toggle, "Objects", objects);
            Undo.RecordObject(instance, "Set imported object default visibility");
            instance.SetActive(visible);
            PrefabUtility.RecordPrefabInstancePropertyModifications(instance);
            EditorUtility.SetDirty(item);
            EditorUtility.SetDirty(toggle);
        }

        private static void Apply(Request request, GameObject avatar, GameObject prefab, string menuName, bool visible, bool preservePreset)
        {
            if (!Valid(request)) throw new InvalidOperationException("The MA request is invalid.");
            if (Terminal(CurrentReceipt(request))) return;
            if (!Imported(request)) throw new InvalidOperationException("The matching package import has not completed.");
            string status = DependencyStatus();
            if (!String.IsNullOrEmpty(status)) throw new InvalidOperationException(status);
            Type descriptor = FindType(AvatarTypeName);
            if (avatar == null || EditorUtility.IsPersistent(avatar) || !avatar.scene.IsValid() || !avatar.scene.isLoaded
                || PrefabStageUtility.GetPrefabStage(avatar) != null || avatar.GetComponent(descriptor) == null)
                throw new InvalidOperationException("Choose an avatar root with a VRChat descriptor in an open scene.");
            string prefabPath = AssetDatabase.GetAssetPath(prefab);
            if (prefab == null || !EditorUtility.IsPersistent(prefab) || !ValidPrefabPath(prefabPath)
                || PrefabUtility.GetPrefabAssetType(prefab) == PrefabAssetType.NotAPrefab
                || AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath) != prefab)
                throw new InvalidOperationException("Choose a Prefab asset under Assets/.");
            NoLinks(Path.Combine(Project, prefabPath));
            Journal journal = CurrentJournal(request);
            string[] choices = PrefabChoices(request);
            if (ImportedPrefabBatch(request).known
                && !choices.Contains(prefabPath, StringComparer.Ordinal))
                throw new InvalidOperationException("Choose a Prefab from this import batch.");
            menuName = (menuName ?? "").Trim();
            if (menuName.Length == 0 || menuName.Length > 120) throw new InvalidOperationException("Choose a menu name between 1 and 120 characters.");
            string groupName = "VRCAL MA " + request.id + " " + request.sha256;
            if (Resources.FindObjectsOfTypeAll<GameObject>().Any(g => !EditorUtility.IsPersistent(g) && g.scene.IsValid() && g.name == groupName))
                throw new InvalidOperationException("This request already has a scene instance. Inspect it before starting a new request.");
            journal.phase = "applying";
            AtomicWrite(MetadataPath("MAState", request.id), journal);
            Undo.IncrementCurrentGroup();
            int undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("Configure imported MA menu");
            try
            {
                GameObject group = new GameObject(groupName);
                Undo.RegisterCreatedObjectUndo(group, "Configure imported MA menu");
                group.transform.SetParent(avatar.transform, false);
                GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, group.transform);
                if (instance == null) throw new InvalidOperationException("Unity could not instantiate this Prefab.");
                Undo.RegisterCreatedObjectUndo(instance, "Configure imported MA menu");
                bool existing = preservePreset && HasPreset(prefab);
                if (!existing) CreateToggle(group, instance, request, menuName, visible);
                Undo.FlushUndoRecordObjects();
                Undo.CollapseUndoOperations(undoGroup);
                WriteReceipt(request, "applied", existing
                    ? "Prefab instance added with its existing MA menu and defaults. Scene changes are unsaved; one Undo removes the setup."
                    : "MA visibility menu created. Scene changes are unsaved; one Undo removes the setup. Clothing fit and avatar builds still require your check.", avatar, prefabPath, existing ? "Existing MA preset" : menuName);
                // Receipt is the commit record. A stale applying journal is harmless once this terminal receipt exists.
                Selection.activeGameObject = group;
            }
            catch (Exception exception)
            {
                Undo.RevertAllDownToGroup(undoGroup);
                journal.phase = "failed";
                try { AtomicWrite(MetadataPath("MAState", request.id), journal); WriteReceipt(request, "error", "MA setup rolled back: " + exception.Message); }
                catch (Exception writeError) { Warn(writeError); }
                throw;
            }
            finally { Undo.IncrementCurrentGroup(); }
            RefreshRequests();
        }

        // UI-only localization: keep receipt messages and state identifiers stable for old app versions.
        private static readonly Dictionary<string, string> Chinese = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "VRCAL · MA setup", "VRCAL · MA 装配助手" },
            { "Set up imported Prefab with Modular Avatar", "使用 Modular Avatar 装配导入的预制件" },
            { "MA assembly places the imported Prefab directly under the selected avatar as its last child. Several avatars or Prefabs require your choice. One Undo removes the assembly; save the scene yourself after checking it.", "预制件会装配到所选角色下，放在角色层级最底部。有多个角色或预制件时，请先选择。可用 Unity 撤销装配；检查完成后请自行保存场景。" },
            { "Refresh pending imports", "刷新待处理的导入" },
            { "No pending requests. In VRC Asset Library, enable MA assembly before importing. Completed, skipped, and failed requests are not reapplied automatically.", "暂无待处理请求。请先在素材管理器中勾选 MA 装配，再导入素材。已完成、已跳过和失败的请求不会自动重复执行。" },
            { "Choose an import…", "请选择一次导入…" }, { "Import", "导入记录" },
            { "Waiting for request status.", "正在等待请求状态。" },
            { "Loaded avatar", "已加载的角色" }, { "Choose an avatar…", "请选择角色…" },
            { "Scene avatar root", "场景角色根对象" }, { "Imported Prefab", "本次导入的预制件" },
            { "Choose a Prefab…", "请选择预制件…" }, { "Prefab asset", "预制件资源" },
            { "No Prefab from this import batch is available in Assets. Check the package import selection and Unity compilation status before refreshing.", "Assets 中尚未找到本次导入的可用预制件。请核对素材包导入选项，等待 Unity 编译完成后再刷新。" },
            { "Unity did not provide a known Prefab list for this batch. Choose the intended imported Prefab asset manually; VRCAL does not guess.", "Unity 未返回本次导入的预制件清单，请手动选择正确的预制件资源。" },
            { "Keep existing MA preset", "保留作者的 MA 预设" },
            { "Existing menu names, defaults, and parameters will be preserved on the new instance.", "新实例将保留原有的菜单名称、默认状态和参数。" },
            { "Menu name", "菜单名称" }, { "Visible by default", "默认显示" },
            { "This older request creates a visibility menu. Clothing bone setup and fitting need separate checks.", "此旧版请求将创建显示／隐藏菜单。服装骨骼装配、适配和穿模仍需单独检查。" },
            { "Existing valid MA armature or Bone Proxy bindings are preserved. Skeletal outfits use MA's public Setup Outfit command, and the result must bind to your selected avatar. Unknown ordinary Prefabs need an explicit attachment configuration. Fit and clipping still need your check.", "保留有效的 MA 骨架合并或骨骼代理绑定。带骨骼的服装使用 MA 的 Setup Outfit（设置服装）命令，并核对是否绑定到所选角色。普通预制件需要明确配置挂载位置；适配与穿模请自行检查。" },
            { "Assemble under selected avatar · Undo supported", "装配到所选角色最底部 · 支持撤销" },
            { "Apply to scene · Undo supported", "应用到场景 · 支持撤销" },
            { "Skip MA setup · keep imported files", "跳过 MA 装配 · 保留已导入文件" },
            { "Linked project paths are not supported by VRCAL MA.", "MA 助手不支持包含目录链接的工程路径。" },
            { "VRCAL MA metadata is too large.", "MA 记录文件过大，无法安全读取。" },
            { "MA receipt identity conflicts with the request. No changes were made.", "MA 回执与请求的身份信息不一致，未作任何修改。" },
            { "MA recovery metadata conflicts with the request.", "MA 恢复记录与当前请求不一致，请核对工程。" },
            { "Invalid MA request or request for a different project; ignored.", "MA 请求无效或属于其他工程，已忽略。" },
            { "Package import was cancelled. MA setup was skipped; imported files were not changed.", "素材包导入已取消，已跳过 MA 装配；已导入的文件保持原样。" },
            { "Package import failed. MA setup was not applied; inspect the separate import result.", "素材包导入失败，未进行 MA 装配。请在素材管理器中查看导入结果。" },
            { "Unity stopped during MA setup. Inspect the scene and Undo history before starting a new request; automatic reapplication is disabled.", "Unity 在 MA 装配过程中中断。请先检查场景与撤销记录，再发起新的请求；不会自动重复装配。" },
            { "Waiting for the matching Unity package import to complete.", "等待本次 Unity 素材包导入完成。" },
            { "Choose a loaded avatar and Prefab, then apply. Scene changes are not saved automatically.", "请选择已加载的角色和预制件，再点击应用。场景不会自动保存。" },
            { "VRChat Avatars SDK is missing. Install a compatible SDK yourself, then reopen this window.", "工程缺少 VRChat Avatars SDK。请安装兼容版本后重新打开此窗口。" },
            { "Modular Avatar menu components are missing or incompatible. Install a compatible Modular Avatar version yourself.", "Modular Avatar 菜单组件缺失或不兼容。请安装兼容的 Modular Avatar 版本。" },
            { "Modular Avatar assembly components are missing. Install a compatible Modular Avatar version yourself.", "工程缺少 Modular Avatar 装配组件。请安装兼容的 Modular Avatar 版本。" },
            { "The public MA Setup Outfit Editor API is unavailable. Check the installed MA version and Unity compilation errors.", "MA 的 Setup Outfit（设置服装）接口不可用。请检查 MA 版本与 Unity 编译错误。" },
            { "Waiting for a VRChat avatar in an open scene. Open the intended avatar scene, then refresh.", "当前场景中没有可用的 VRChat 角色。请打开目标角色所在场景，再刷新。" },
            { "Several avatars are loaded. Choose the intended avatar and imported Prefab before assembly.", "当前加载了多个角色。请先选择目标角色和本次导入的预制件，再进行装配。" },
            { "Unity reported only part of the imported paths. Choose a reported Prefab explicitly; automatic assembly is disabled.", "Unity 只返回了部分导入路径，已停用自动装配。请明确选择一个已返回的预制件。" },
            { "Choose the intended imported Prefab before assembly. No scene changes have been made.", "请先选择要装配的预制件，当前尚未修改场景。" },
            { "One avatar and one imported Prefab are available. MA assembly will run automatically; one Undo removes it. Save the scene yourself after checking it.", "已找到唯一角色和唯一预制件，将自动进行 MA 装配。可用 Unity 撤销；检查后请自行保存场景。" },
            { "This Prefab has no verified MA armature or Bone Proxy binding to the selected avatar.", "此预制件尚未确认与所选角色的 MA 骨架合并或骨骼代理绑定。" },
            { "The MA assembly request is invalid.", "MA 装配请求无效。" },
            { "The matching package import has not completed.", "对应的素材包尚未完成导入。" },
            { "Choose a VRChat avatar root in an open scene.", "请选择已打开场景中的 VRChat 角色根对象。" },
            { "Choose a Prefab asset under Assets/.", "请选择 Assets/ 下的预制件资源，不能选择场景中的实例。" },
            { "Choose a Prefab from this import batch.", "请选择本次导入中的预制件。" },
            { "Unity could not instantiate this Prefab.", "Unity 无法创建此预制件的实例。" },
            { "MA changed the Prefab root parent unexpectedly. Assembly was rolled back.", "MA 意外改变了预制件根对象的父级，已撤销本次装配。" },
            { "Prefab assembled as the avatar's last direct child with its existing verified MA binding. Scene changes are unsaved; one Undo removes the assembly.", "预制件已装配到角色层级最底部，并保留已验证的 MA 绑定。场景尚未保存，可用 Unity 撤销本次装配。" },
            { "MA Setup Outfit completed and its binding resolves to the selected avatar. Prefab is the avatar's last direct child. Scene changes are unsaved; one Undo removes the assembly. Check fit and clipping yourself.", "MA 服装设置完成，已核对绑定到所选角色，预制件位于角色层级最底部。场景尚未保存，可用 Unity 撤销；适配和穿模请自行检查。" },
            { "This MA version does not expose its VRChat menu control API.", "当前 MA 版本未提供兼容的 VRChat 菜单控件接口。" },
            { "Installed SDK menu parameter API is incompatible.", "当前 SDK 的菜单参数接口不兼容。" },
            { "This MA version has an incompatible Object Toggle API.", "当前 MA 版本的 Object Toggle（物体开关）接口不兼容。" },
            { "This MA version cannot reference the imported instance.", "当前 MA 版本无法引用导入的预制件实例。" },
            { "The MA request is invalid.", "MA 请求无效。" },
            { "Choose an avatar root with a VRChat descriptor in an open scene.", "请选择已打开场景中带有 VRChat Avatar Descriptor 的角色根对象。" },
            { "Choose a menu name between 1 and 120 characters.", "菜单名称应为 1～120 个字符。" },
            { "This request already has a scene instance. Inspect it before starting a new request.", "此请求已在场景中创建过实例，请先检查已有实例再发起新请求。" },
            { "Prefab instance added with its existing MA menu and defaults. Scene changes are unsaved; one Undo removes the setup.", "已添加预制件实例，并保留原有的 MA 菜单与默认状态。场景尚未保存，可用 Unity 撤销。" },
            { "MA visibility menu created. Scene changes are unsaved; one Undo removes the setup. Clothing fit and avatar builds still require your check.", "已创建 MA 显示／隐藏菜单。场景尚未保存，可用 Unity 撤销；服装适配和角色构建仍需检查。" },
            { "MA setup skipped. Imported files are unchanged.", "已跳过 MA 装配，已导入的文件保持原样。" }
        };

        private static string Ui(string message)
        {
            if (String.IsNullOrEmpty(message)) return "";
            string translated;
            if (Chinese.TryGetValue(message, out translated)) return translated;
            foreach (KeyValuePair<string, string> prefix in new[] {
                new KeyValuePair<string, string>("MA assembly rolled back: ", "MA 装配已撤销："),
                new KeyValuePair<string, string>("MA setup rolled back: ", "MA 配置已撤销："),
                new KeyValuePair<string, string>("Installed MA API is incompatible: ", "当前 MA 接口不兼容："),
                new KeyValuePair<string, string>("MA Setup Outfit did not establish a valid binding. ", "MA 设置服装后未建立有效绑定。") })
                if (message.StartsWith(prefix.Key, StringComparison.Ordinal)) return prefix.Value + Ui(message.Substring(prefix.Key.Length));
            const string extra = " This is not a recognized skeletal outfit; configure its attachment explicitly in MA.";
            if (message.EndsWith(extra, StringComparison.Ordinal))
                return Ui(message.Substring(0, message.Length - extra.Length)) + " 此预制件不是可识别的骨骼服装，请在 MA 中明确配置挂载位置。";
            const string binding = "MA binding on '", suffix = "' does not resolve to the selected avatar. Check its Merge Armature or Bone Proxy target.";
            if (message.StartsWith(binding, StringComparison.Ordinal) && message.EndsWith(suffix, StringComparison.Ordinal))
                return "“" + message.Substring(binding.Length, message.Length - binding.Length - suffix.Length) + "”上的 MA 绑定未指向所选角色，请检查其 Merge Armature（骨架合并）或 Bone Proxy（骨骼代理）的目标。";
            // Unknown third-party diagnostics stay intact; never translate object names, paths or arbitrary user content.
            return message;
        }

        private sealed class SetupWindow : EditorWindow
        {
            private string requestId;
            private GameObject avatar, prefab;
            private string menuName = "导入的素材", error = "";
            private bool visible = true, preservePreset = true;
            private Vector2 scroll;

            private void OnEnable()
            {
                titleContent = new GUIContent(Ui("VRCAL · MA setup"));
                minSize = new Vector2(460, 440);
            }

            internal static void Open()
            {
                SetupWindow window = GetWindow<SetupWindow>(Ui("VRCAL · MA setup"));
                window.minSize = new Vector2(460, 440);
                window.Show();
            }
            private void OnGUI()
            {
                scroll = EditorGUILayout.BeginScrollView(scroll);
                EditorGUILayout.LabelField(Ui("Set up imported Prefab with Modular Avatar"), EditorStyles.boldLabel);
                EditorGUILayout.HelpBox(Ui("MA assembly places the imported Prefab directly under the selected avatar as its last child. Several avatars or Prefabs require your choice. One Undo removes the assembly; save the scene yourself after checking it."), MessageType.Info);
                if (GUILayout.Button(Ui("Refresh pending imports"))) { RefreshRequests(); Repaint(); }
                if (Pending.Count == 0)
                {
                    EditorGUILayout.HelpBox(Ui("No pending requests. In VRC Asset Library, enable MA assembly before importing. Completed, skipped, and failed requests are not reapplied automatically."), MessageType.Info);
                    EditorGUILayout.EndScrollView(); return;
                }
                string[] labels = new[] { Ui("Choose an import…") }.Concat(Pending.Select(r => r.sourceName + " · " + r.id.Substring(0, 8))).ToArray();
                int selected = Pending.FindIndex(r => r.id == requestId) + 1;
                int next = EditorGUILayout.Popup(Ui("Import"), selected, labels);
                if (next != selected) { requestId = next == 0 ? null : Pending[next - 1].id; avatar = null; prefab = null; error = ""; }
                Request request = Pending.FirstOrDefault(r => r.id == requestId);
                if (request == null) { EditorGUILayout.EndScrollView(); return; }
                Receipt receipt = CurrentReceipt(request);
                EditorGUILayout.HelpBox(Ui(receipt == null ? "Waiting for request status." : receipt.message), MessageType.Info);
                string dependencies = request.assemble ? AssemblyDependencyStatus() : DependencyStatus();
                if (!String.IsNullOrEmpty(dependencies)) EditorGUILayout.HelpBox(Ui(dependencies), MessageType.Warning);
                GameObject[] avatars = AvatarChoices();
                int avatarIndex = Array.IndexOf(avatars, avatar) + 1;
                int nextAvatar = EditorGUILayout.Popup(Ui("Loaded avatar"), avatarIndex,
                    new[] { Ui("Choose an avatar…") }.Concat(avatars.Select(g => g.name + " · " + g.scene.name)).ToArray());
                if (nextAvatar != avatarIndex) avatar = nextAvatar == 0 ? null : avatars[nextAvatar - 1];
                avatar = (GameObject)EditorGUILayout.ObjectField(Ui("Scene avatar root"), avatar, typeof(GameObject), true);
                string[] paths = PrefabChoices(request);
                if (paths.Length > 0)
                {
                    string current = prefab == null ? "" : AssetDatabase.GetAssetPath(prefab);
                    int index = Array.IndexOf(paths, current) + 1;
                    int choice = EditorGUILayout.Popup(Ui("Imported Prefab"), index, new[] { Ui("Choose a Prefab…") }.Concat(paths).ToArray());
                    if (choice != index) prefab = choice == 0 ? null : AssetDatabase.LoadAssetAtPath<GameObject>(paths[choice - 1]);
                }
                else
                {
                    bool known = ImportedPrefabBatch(request).known;
                    if (known)
                    {
                        EditorGUILayout.HelpBox(Ui("No Prefab from this import batch is available in Assets. Check the package import selection and Unity compilation status before refreshing."), MessageType.Warning);
                        prefab = null;
                    }
                    else
                    {
                        EditorGUILayout.HelpBox(Ui("Unity did not provide a known Prefab list for this batch. Choose the intended imported Prefab asset manually; VRCAL does not guess."), MessageType.Warning);
                        prefab = (GameObject)EditorGUILayout.ObjectField(Ui("Prefab asset"), prefab, typeof(GameObject), false);
                    }
                }
                if (!request.assemble)
                {
                    bool preset = prefab != null && HasPreset(prefab);
                    if (preset) preservePreset = EditorGUILayout.Toggle(Ui("Keep existing MA preset"), preservePreset);
                    if (preset && preservePreset) EditorGUILayout.HelpBox(Ui("Existing menu names, defaults, and parameters will be preserved on the new instance."), MessageType.Info);
                    using (new EditorGUI.DisabledScope(preset && preservePreset))
                    {
                        menuName = EditorGUILayout.TextField(Ui("Menu name"), menuName);
                        visible = EditorGUILayout.Toggle(Ui("Visible by default"), visible);
                    }
                    EditorGUILayout.HelpBox(Ui("This older request creates a visibility menu. Clothing bone setup and fitting need separate checks."), MessageType.Info);
                }
                else EditorGUILayout.HelpBox(Ui("Existing valid MA armature or Bone Proxy bindings are preserved. Skeletal outfits use MA's public Setup Outfit command, and the result must bind to your selected avatar. Unknown ordinary Prefabs need an explicit attachment configuration. Fit and clipping still need your check."), MessageType.Info);
                if (!String.IsNullOrEmpty(error)) EditorGUILayout.HelpBox(Ui(error), MessageType.Error);
                using (new EditorGUI.DisabledScope(avatar == null || prefab == null || !String.IsNullOrEmpty(dependencies) || !Imported(request)))
                    if (GUILayout.Button(request.assemble ? Ui("Assemble under selected avatar · Undo supported") : Ui("Apply to scene · Undo supported")))
                        try { if (request.assemble) ApplyAssembly(request, avatar, prefab); else Apply(request, avatar, prefab, menuName, visible, preservePreset); error = ""; }
                        catch (Exception exception) { error = exception.Message; }
                if (GUILayout.Button(Ui("Skip MA setup · keep imported files")))
                {
                    WriteReceipt(request, "skipped", "MA setup skipped. Imported files are unchanged.");
                    RefreshRequests();
                }
                EditorGUILayout.EndScrollView();
            }
        }
    }
}
