# 工程素材读取与导入实现计划

**目标：** 展示 Unity 工程 Assets 的真实文件与 Packages 信息，支持通过 Unity 原生确认窗口导入 unitypackage，以及保持 meta 引用复制普通文件/文件夹。用户已选择两种都支持。

**约束：** 浏览、扫描及原素材保持只读；仅在用户主动导入时写入所选工程。原有全局素材保护不放宽；导入服务单独限制工程 Assets/VRCAL_Imports、新建的 Assets/VRCALImportBridge 助手与 Library/VRCALImportBridge 通信目录。拒绝目录链接、越界路径、重复 GUID、覆盖已有文件；使用唯一目标目录。人工关联和标注保留。压缩包不自动解压。

**架构：** 主进程解析已登记素材和工程 ID，renderer 不提供任意源/目标写入路径。浏览 API 按文件夹分页。导入先生成短期预览令牌，执行时重新验证项目及源文件；复制先暂存再提交，元数据与内容一起保留。Unity 包经打包的 Editor 助手调用 AssetDatabase.ImportPackage(path, true)，以回执区分等待、完成、取消和失败，绝不把提交请求当完成。Hub 编辑器仅自动发现相同工程版本，允许原生文件选择器指定 Unity.exe。任务日志保存在资料库，重启后读取回执。

- [x] 工程访问与浏览：project-access.ts / project-files.ts；测试中文日文表情、多层 Assets、只读、目录链接、相对路径越界、分页。
- [x] 复制导入：project-import.ts；测试源哈希、meta 保持、源/目标交叉、GUID 冲突、重复点击、源改变、失败回滚、已有工程文件不变。
- [x] Unity 导入：unity-editors.ts、assets/unity/Editor 助手；测试预览令牌、固定启动参数、等待/取消/失败回执、重启恢复、重复回执与关联幂等。实际 Unity 2022.3 编译和合成工程测试，不能以模拟回执声称完成真实导入。
- [x] 接口和界面：project-contracts.ts、contracts/preload/main；工程详情浏览入口、素材右键和详情导入入口，目标工程选择，源文件选择，导入预览、进度与历史。新增中日英文案，沿用四主题。
- [x] 验收：完整回归，隔离 Electron UI、980px/200%、实际打包启动、资源完整性、三语说明。真实用户素材和工程不作为写入测试目标。

## 接口

- projectFiles(projectId, relativePath?, offset?): ProjectFilePage（Assets 内相对路径、文件类型、大小、分页，工程版本和依赖只读）
- projectFileAction(projectId, relativePath, action): 定位或复制已校验工程文件路径
- importSources(assetId): ImportSourceChoice[]（已登记成员和素材文件夹内的 unitypackage，选择 ID 在主进程解析）
- previewProjectImport(assetId, projectId, choiceId): ProjectImportPreview（短期 token、模式、文件数/大小、GUID 冲突/警告）
- executeProjectImport(token): ProjectImportJob（再验证、单工程串行；复制完成或 Unity 等待状态）
- projectImportJobs(projectId?): ProjectImportJob[]（刷新 Unity 回执与已完成关联）
- chooseProject(): AssetRecord|null（原生选择后只登记此工程根）
- chooseUnityEditor(): 路径由原生选择器处理，写入资料库设置，不接收 renderer 任意命令。

## 验证重点

实际文件存在不等于场景正在引用。复制导入仅保证文件提交，Unity 的资源处理错误不能冒充成功。Unity 原生窗口保留用户对覆盖和导入项的选择；存在编译错误/关闭自动刷新时明确等待助手载入，不宣称已导入。外部网页仍无桌面接口。

验收界限：真实 Unity 2022.3 助手编译与接收请求已验证；后台模式不能点击原生导入确认，未声称已完成人工交互导入。
