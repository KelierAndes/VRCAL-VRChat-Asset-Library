// VRCAL owned Editor helper, version 2. GPL-3.0-only. Installed only by an explicit package import.
// No server, network access, runtime component, arbitrary command execution, or automatic package extraction.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace VRCAL.LocalAssets
{
    [InitializeOnLoad]
    public static class VRCALImportBridge
    {
        [Serializable] private class Request
        {
            public int schema = 0;
            public string id = "";
            public string projectPath = "";
            public string sourcePath = "";
            public string sha256 = "";
        }
        [Serializable] private class Receipt
        {
            public int schema = 1;
            public string id;
            public string sha256;
            public string state;
            public string message;
            public string[] importedAssetPaths;
            public bool importedPathsComplete;
        }
        [Serializable] private class Capture
        {
            public string id;
            public string sha256;
            public string package;
            public bool open;
            public bool completed;
            public bool known;
            public bool complete;
            public string[] paths;
        }

        private const string SessionKey = "VRCAL.Import.Active.v1";
        private const string PackageKey = "VRCAL.Import.Package.v1";
        private const string CaptureKey = "VRCAL.Import.Paths.v1";
        private static readonly Regex Id = new Regex("^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", RegexOptions.IgnoreCase);
        private static readonly Regex Hash = new Regex("^[a-f0-9]{64}$", RegexOptions.IgnoreCase);
        private static readonly string Project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
        private static readonly string Root = Path.Combine(Project, "Library", "VRCALImportBridge");
        private static Request active;
        private static Capture captured;
        private static double nextPoll;

        static VRCALImportBridge()
        {
            try
            {
                string saved = SessionState.GetString(SessionKey, "");
                if (!String.IsNullOrEmpty(saved))
                {
                    Request request = JsonUtility.FromJson<Request>(saved);
                    if (Valid(request)) active = request;
                }
                if (active == null) RecoverInterrupted();
                else RestoreCapture();
            }
            catch (Exception exception) { Debug.LogWarning("VRCAL: " + exception.Message); }
            AssetDatabase.importPackageStarted += Started;
            AssetDatabase.importPackageCompleted += Completed;
            AssetDatabase.importPackageCancelled += Cancelled;
            AssetDatabase.importPackageFailed += Failed;
            AssetDatabase.onImportPackageItemsCompleted += PackageItems;
            EditorApplication.update += Poll;
            if (captured != null && captured.completed) EditorApplication.delayCall += CompletePending;
        }

        private static bool Valid(Request request)
        {
            return request != null && request.schema == 1 && request.id != null && Id.IsMatch(request.id)
                && request.sha256 != null && Hash.IsMatch(request.sha256)
                && !String.IsNullOrEmpty(request.projectPath)
                && String.Equals(Path.GetFullPath(request.projectPath), Project, StringComparison.OrdinalIgnoreCase);
        }

        private static void NoLinks(string path)
        {
            for (string cursor = Path.GetFullPath(path); !String.IsNullOrEmpty(cursor); cursor = Path.GetDirectoryName(cursor))
                if ((File.Exists(cursor) || Directory.Exists(cursor)) && (File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("VRCAL refuses linked paths.");
        }

        private static Request ReadRequest(string path)
        {
            NoLinks(path);
            FileInfo info = new FileInfo(path);
            if (!info.Exists || info.Length > 65536) throw new IOException("Invalid VRCAL request.");
            Request request = JsonUtility.FromJson<Request>(File.ReadAllText(path, Encoding.UTF8));
            if (!Valid(request)) throw new IOException("The VRCAL request is for another project or has an invalid identity.");
            return request;
        }

        private static void WriteReceipt(Request request, string state, string message = "")
        {
            if (!Valid(request)) return;
            string directory = Path.Combine(Root, "Results");
            NoLinks(directory);
            Directory.CreateDirectory(directory);
            string target = Path.Combine(directory, request.id + ".json");
            NoLinks(target);
            string temporary = Path.Combine(directory, "r" + Guid.NewGuid().ToString("N").Substring(0, 12) + ".tmp");
            try
            {
                Receipt receipt = new Receipt { id = request.id, sha256 = request.sha256, state = state, message = message == null ? "" : message.Substring(0, Math.Min(message.Length, 2000)) };
                if (state == "completed")
                {
                    bool known = CaptureMatches() && captured.known;
                    receipt.importedAssetPaths = known ? captured.paths : null;
                    receipt.importedPathsComplete = known && captured.complete;
                    if (!known) receipt.message = "Unity did not report the selected Assets paths; the import location is unknown.";
                }
                using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
                    writer.Write(JsonUtility.ToJson(receipt));
                NoLinks(directory);
                if (File.Exists(target)) File.Replace(temporary, target, null);
                else File.Move(temporary, target);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static void RecoverInterrupted()
        {
            string requests = Path.Combine(Root, "Requests");
            NoLinks(requests);
            if (!Directory.Exists(requests)) return;
            foreach (string file in Directory.GetFiles(requests, "*.json.claimed"))
            {
                try
                {
                    Request request = ReadRequest(file);
                    string result = Path.Combine(Root, "Results", request.id + ".json");
                    NoLinks(result);
                    Receipt receipt = File.Exists(result) ? JsonUtility.FromJson<Receipt>(File.ReadAllText(result)) : null;
                    if (receipt == null || receipt.state == "importing")
                        WriteReceipt(request, "failed", "Unity closed before a final receipt. Check the project before retrying.");
                }
                catch (Exception exception) { Debug.LogWarning("VRCAL: " + exception.Message); }
            }
        }

        private static void Poll()
        {
            if (active != null || EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 1.0;
            try
            {
                string requests = Path.Combine(Root, "Requests");
                NoLinks(requests);
                if (!Directory.Exists(requests)) return;
                string[] files = Directory.GetFiles(requests, "*.json");
                Array.Sort(files, StringComparer.Ordinal);
                foreach (string file in files)
                {
                    if (!file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) continue;
                    Request request = ReadRequest(file);
                    if (!String.Equals(Path.GetFileNameWithoutExtension(file), request.id, StringComparison.OrdinalIgnoreCase)) continue;
                    string claimed = file + ".claimed";
                    NoLinks(claimed);
                    try { File.Move(file, claimed); } catch (IOException) { continue; } // Cancellation and claiming are mutually exclusive renames.
                    active = request;
                    SessionState.SetString(SessionKey, JsonUtility.ToJson(active));
                    SessionState.SetString(PackageKey, "");
                    captured = null;
                    SessionState.EraseString(CaptureKey);
                    try
                    {
                        if (String.IsNullOrEmpty(active.sourcePath) || !Path.IsPathRooted(active.sourcePath)
                            || !active.sourcePath.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase))
                            throw new IOException("Not a local unitypackage.");
                        NoLinks(active.sourcePath);
                        using (FileStream stream = File.Open(active.sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read))
                        using (SHA256 hash = SHA256.Create())
                        {
                            string actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                            if (!String.Equals(actual, active.sha256, StringComparison.OrdinalIgnoreCase))
                                throw new IOException("The source package changed after preview.");
                        }
                        WriteReceipt(active, "importing", "Confirm the package in Unity.");
                        AssetDatabase.ImportPackage(active.sourcePath, true);
                    }
                    catch (Exception exception) { Finish("failed", exception.Message); }
                    break;
                }
            }
            catch (Exception exception) { Debug.LogWarning("VRCAL: " + exception.Message); }
        }

        private static bool Expected(string name)
        {
            if (active == null) return false;
            string observed = SessionState.GetString(PackageKey, "");
            string incoming = name != null && name.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase) ? Path.GetFileNameWithoutExtension(name) : Path.GetFileName(name);
            return (!String.IsNullOrEmpty(observed) && String.Equals(observed, name, StringComparison.OrdinalIgnoreCase))
                || String.Equals(Path.GetFileNameWithoutExtension(active.sourcePath), incoming, StringComparison.OrdinalIgnoreCase);
        }
        private static void Started(string name)
        {
            if (active == null) return;
            if (CaptureMatches() && captured.completed)
            {
                // A new package, including one with the same basename, cannot replace a completed batch.
                captured.open = false;
                SaveCapture();
                return;
            }
            if (Expected(name))
            {
                SessionState.SetString(PackageKey, name);
                captured = new Capture { id = active.id, sha256 = active.sha256, package = name, open = true };
                SaveCapture();
            }
            else if (CaptureMatches())
            {
                // The items callback has no package name. A later manual import closes this capture window.
                captured.open = false;
                captured.known = false;
                captured.paths = null;
                captured.complete = false;
                SaveCapture();
            }
        }
        private static bool CaptureMatches()
        {
            return active != null && captured != null && captured.id == active.id && captured.sha256 == active.sha256;
        }
        private static void SaveCapture()
        {
            if (CaptureMatches()) SessionState.SetString(CaptureKey, JsonUtility.ToJson(captured));
        }
        private static void RestoreCapture()
        {
            captured = null;
            string saved = SessionState.GetString(CaptureKey, "");
            if (active == null || String.IsNullOrEmpty(saved) || saved.Length > 1048576) return;
            Capture candidate = JsonUtility.FromJson<Capture>(saved);
            if (candidate == null || candidate.id != active.id || candidate.sha256 != active.sha256
                || !Expected(candidate.package) || candidate.package != SessionState.GetString(PackageKey, "")) return;
            if (candidate.known)
            {
                if (candidate.paths == null || candidate.paths.Length > 10000) return;
                int bytes = 0;
                foreach (string item in candidate.paths)
                {
                    if (!ValidImportedPath(item)) return;
                    bytes += Encoding.UTF8.GetByteCount(item) * 2 + 3;
                    if (bytes > 900000) return;
                }
            }
            captured = candidate;
        }
        private static bool ValidImportedPath(string item)
        {
            if (String.IsNullOrEmpty(item) || item.Length > 32760 || !item.StartsWith("Assets/", StringComparison.Ordinal)
                || item.IndexOf(':') >= 0 || item.IndexOf('\\') >= 0) return false;
            foreach (char character in item) if (Char.IsControl(character)) return false;
            foreach (string part in item.Split('/'))
                if (String.IsNullOrEmpty(part) || part == "." || part == ".." || part.EndsWith(".", StringComparison.Ordinal) || part.EndsWith(" ", StringComparison.Ordinal)) return false;
            return true;
        }
        private static void PackageItems(string[] items)
        {
            if (!CaptureMatches() || !captured.open || captured.known || !Expected(captured.package)
                || captured.package != SessionState.GetString(PackageKey, "") || items == null) return;
            List<string> paths = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            bool complete = items.Length <= 10000;
            int bytes = 0;
            for (int index = 0; index < Math.Min(items.Length, 10000); index++)
            {
                string item = items[index];
                if (!ValidImportedPath(item)) { complete = false; continue; }
                if (!seen.Add(item)) continue;
                int size = Encoding.UTF8.GetByteCount(item) * 2 + 3;
                if (bytes + size > 900000) { complete = false; break; }
                bytes += size;
                paths.Add(item);
            }
            captured.paths = paths.ToArray();
            captured.known = true;
            captured.complete = complete;
            SaveCapture();
        }
        private static void Completed(string name)
        {
            if (!Expected(name)) return;
            if (!CaptureMatches()) captured = new Capture { id = active.id, sha256 = active.sha256, package = name };
            captured.completed = true;
            SaveCapture();
            // Unity versions may dispatch selected items on either side of the named completion callback.
            EditorApplication.delayCall += CompletePending;
        }
        private static void CompletePending()
        {
            if (CaptureMatches() && captured.completed) Finish("completed", "");
        }
        private static void Cancelled(string name) { if (Expected(name) && !(CaptureMatches() && captured.completed)) Finish("cancelled", ""); }
        private static void Failed(string name, string error) { if (Expected(name) && !(CaptureMatches() && captured.completed)) Finish("failed", error); }
        private static void Finish(string state, string message)
        {
            Request request = active;
            try { if (request != null) WriteReceipt(request, state, message); }
            finally
            {
                active = null;
                captured = null;
                SessionState.EraseString(SessionKey);
                SessionState.EraseString(PackageKey);
                SessionState.EraseString(CaptureKey);
            }
        }
    }
}
