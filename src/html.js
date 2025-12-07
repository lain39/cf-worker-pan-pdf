export const FAVICON_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
    <path fill="rgb(50,120,200)" d="M64 288C64 341 107 384 160 384L198.6 384L322.7 273C334.9 262.1 350.7 256 367.1 256C411.7 256 443.6 299 430.8 
    341.7L418.1 384L480 384C533 384 576 341 576 288C576 235 533 192 480 192C479.5 192 478.9 192 478.4 192C479.5 186.8 480 181.5 480 176C480 131.8 
    444.2 96 400 96C375.7 96 353.9 106.9 339.2 124C320.5 88.3 283.1 64 240 64C178.1 64 128 114.1 128 176C128 183.1 128.7 190.1 129.9 196.8C91.6 
    209.4 64 245.5 64 288zM224.6 464L286.4 464L255.2 568.1C251.6 580 260.5 592 273 592C277.6 592 282 590.3 285.4 587.3L426.5 460.9C430 457.8 432 
    453.3 432 448.5C432 439.3 424.6 431.9 415.4 431.9L353.6 431.9L384.8 327.8C388.4 315.9 379.5 303.9 367 303.9C362.4 303.9 358 305.6 354.6 
    308.6L213.5 435.1C210 438.2 208 442.7 208 447.5C208 456.7 215.4 464.1 224.6 464.1z"/>
</svg>`

export const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BaiduDisk Fxxxer</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <!--__SERVER_CONFIG__-->
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
        .fade-enter-from, .fade-leave-to { opacity: 0; }
        .list-enter-active, .list-leave-active { transition: all 0.4s ease; }
        .list-enter-from, .list-leave-to { opacity: 0; transform: translateY(10px); }
        .modal-enter-active, .modal-leave-active { transition: all 0.3s ease; }
        .modal-enter-from, .modal-leave-to { opacity: 0; transform: scale(0.95); }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
    </style>
</head>
<body class="bg-gray-50 text-slate-800 min-h-screen">
    <div id="app" class="max-w-6xl mx-auto px-4 py-8">
        
        <!-- Header -->
        <header class="flex flex-col md:flex-row items-center justify-between mb-8 gap-4 select-none">
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-2xl shadow-lg shadow-indigo-200">
                    <i class="fa-solid fa-cloud-bolt"></i>
                </div>
                <div>
                    <h1 class="text-2xl font-bold text-slate-900 tracking-tight">BaiduDisk Fxxxer </h1>
                    <p class="text-sm text-slate-500 font-medium">PDF小文件预览服务</p>
                </div>
            </div>
            
            <div class="flex items-center gap-3">
                <!-- User Info -->
                <div v-if="currentUser" class="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-sm text-slate-600 shadow-sm">
                    <i class="fa-solid fa-user-circle text-indigo-500"></i>
                    <span class="font-medium max-w-[150px] truncate">{{ currentUser.name || currentUser.username }}</span>
                </div>

                <transition name="fade">
                    <button v-if="resultLinks.length > 0 || failedList.length > 0 || skippedList.length > 0" @click="showResultModal = true" class="w-10 h-10 rounded-full bg-white border border-slate-200 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center justify-center shadow-sm" title="查看结果">
                        <i class="fa-solid fa-list-check"></i>
                    </button>
                </transition>
                
                <!-- Auth Button -->
                <button v-if="serverConfig.authEnabled" @click="openAuthSettings" 
                    class="w-10 h-10 rounded-full bg-white border border-slate-200 transition-colors flex items-center justify-center shadow-sm relative group" 
                    :class="authStatus ? 'text-emerald-500 hover:bg-emerald-50 hover:border-emerald-200' : 'text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200'"
                    title="鉴权设置">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span class="absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white" :class="authStatus ? 'bg-emerald-500' : 'bg-red-400'"></span>
                </button>

                <!-- Settings Button -->
                <button @click="openSettings" class="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center justify-center shadow-sm" title="系统设置">
                    <i class="fa-solid fa-gear"></i>
                </button>
                <a href="https://github.com/lain39/cf-worker-pan-pdf" target="_blank"
                    class="w-10 h-10 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-black hover:bg-slate-50 transition-colors flex items-center justify-center shadow-sm" title="访问 GitHub 项目">
                    <i class="fa-brands fa-github text-lg"></i>
                </a>
            </div>
        </header>

        <!-- Input Area -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6 transition-all focus-within:ring-2 ring-indigo-100 ring-offset-2">
            <label class="block text-sm font-semibold text-slate-700 mb-2">资源分享链接</label>
            <div class="flex flex-col md:flex-row gap-3">
                <div class="relative flex-1">
                    <input type="text" v-model="link" @keyup.enter="analyzeLink"
                        placeholder="粘贴链接，例如: https://pan.baidu.com/s/1xxxxxx?pwd=xxxx" 
                        class="w-full pl-11 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors text-slate-700 font-mono text-sm">
                    
                    <!-- Link Icon -->
                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                        <i class="fa-solid fa-link"></i>
                    </div>

                    <!-- Clear Button -->
                    <button v-if="link" @click="link = ''" 
                        class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                        title="清空输入">
                        <i class="fa-solid fa-circle-xmark"></i>
                    </button>
                </div>
                <button @click="analyzeLink" :disabled="loading" 
                    class="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-md shadow-indigo-100 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]">
                    <i v-if="loading" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
                    {{ loading ? '解析中...' : '开始解析' }}
                </button>
            </div>
            <transition name="fade">
                <div v-if="errorMsg" class="mt-4 p-4 bg-red-50 text-red-700 text-sm rounded-xl flex items-start gap-3 border border-red-100">
                    <i class="fa-solid fa-circle-exclamation mt-0.5"></i>
                    <span>{{ errorMsg }}</span>
                </div>
            </transition>
        </div>

        <!-- File List (Standard) -->
        <transition name="list">
            <div v-if="hasData" class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[600px]">
                
                <!-- Toolbar -->
                <div class="px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/50">
                    <div class="flex items-center text-sm text-slate-600 overflow-x-auto w-full md:w-auto scrollbar-hide pb-2 md:pb-0">
                        <button @click="resetToRoot" class="hover:text-indigo-600 font-bold flex items-center gap-1 transition-colors px-1 rounded hover:bg-slate-200/50 whitespace-nowrap">
                            <i class="fa-solid fa-house"></i> 根目录
                        </button>
                        <template v-for="(folder, index) in currentPath" :key="index">
                            <span class="text-slate-300 mx-1">/</span>
                            <span class="font-medium max-w-[100px] truncate">{{ folder.server_filename }}</span>
                        </template>
                    </div>

                    <div class="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                        <div class="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
                            <input type="checkbox" id="selectAll" :checked="isAllSelected" @change="toggleAll" 
                                class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer">
                            <label for="selectAll" class="text-xs font-medium text-slate-600 cursor-pointer select-none">全选</label>
                            <span class="w-px h-3 bg-slate-300 mx-2"></span>
                            <span class="text-xs text-slate-500">已选 {{ selectedCount }} 项</span>
                        </div>
                        
                        <button @click="submitDownload" :disabled="selectedCount === 0 || processing"
                            class="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg font-medium shadow-sm shadow-emerald-100 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            <i v-if="processing" class="fa-solid fa-spinner fa-spin"></i>
                            <i v-else class="fa-solid fa-bolt"></i>
                            批量解析
                        </button>
                    </div>
                </div>

                <!-- Table -->
                <div class="flex-1 overflow-x-auto relative min-h-[400px]">
                    <div v-if="loadingDir" class="absolute inset-0 z-10 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
                        <div class="flex flex-col items-center gap-3">
                            <i class="fa-solid fa-circle-notch fa-spin text-indigo-500 text-3xl"></i>
                            <p v-if="loadingText" class="text-xs text-indigo-500 font-medium">{{ loadingText }}</p>
                        </div>
                    </div>

                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-50 text-slate-500 font-medium border-b border-slate-100 sticky top-0 z-10">
                            <tr>
                                <th class="p-4 w-14 text-center"> </th>
                                <th class="p-4">文件名</th>
                                <th class="p-4 w-32">大小</th>
                                <th class="p-4 w-32 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-50">
                            <tr v-if="currentPath.length > 0" @click="goUp" class="hover:bg-slate-50 cursor-pointer group">
                                <td class="p-4 text-center"><i class="fa-solid fa-reply text-slate-300 group-hover:text-indigo-400"></i></td>
                                <td class="p-4" colspan="3"><span class="text-slate-500 group-hover:text-indigo-600 font-medium">.. 返回上一级</span></td>
                            </tr>

                            <tr v-for="file in currentList" :key="file.fs_id" 
                                class="group transition-colors"
                                :class="{'hover:bg-indigo-50/50': isSupported(file), 'bg-indigo-50/30': file.selected, 'opacity-60': !isSupported(file)}">
                                
                                <td class="p-4 text-center" :class="{'cursor-pointer': isSupported(file), 'cursor-not-allowed': !isSupported(file)}" @click.stop="handleSelectionClick(file)">
                                    <input type="checkbox" v-model="file.selected" :disabled="!isSupported(file)" @click.stop
                                        class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" 
                                        :class="{'cursor-pointer': isSupported(file)}">
                                </td>
                                
                                <td class="p-4 cursor-pointer" @click.stop="handleNameClick(file)">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0 transition-colors" :class="getIconClass(file)">
                                            <i :class="getIcon(file)"></i>
                                        </div>
                                        <div class="flex flex-col">
                                            <span class="font-medium text-slate-700 group-hover:text-indigo-700 truncate max-w-[200px] sm:max-w-md select-none"
                                                  :class="{'text-slate-400': !isSupported(file)}">
                                                {{ file.server_filename }}
                                            </span>
                                            <span v-if="!isSupported(file)" class="text-[10px] text-red-400">文件过大 (>150MB)，不支持加速</span>
                                        </div>
                                    </div>
                                </td>
                                
                                <td class="p-4 text-slate-500 font-mono text-xs whitespace-nowrap">
                                    {{ formatSize(file.size, file) }}
                                </td>
                                
                                <td class="p-4 text-center" @click.stop>
                                    <button v-if="isSupported(file) && !isFolder(file)" @click="downloadSingle(file)" 
                                        class="px-3 py-1 bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-slate-500 text-xs rounded transition-colors shadow-sm">
                                        <i class="fa-solid fa-bolt"></i> 解析
                                    </button>
                                    <span v-else-if="!isFolder(file)" class="text-xs text-slate-300 cursor-not-allowed">不支持</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="bg-slate-50 border-t border-slate-100 px-6 py-3 flex justify-between items-center text-xs text-slate-400">
                    <span class="flex items-center gap-1"><i class="fa-solid fa-info-circle"></i> 选中文件夹将自动递归获取内部文件</span>
                    <span>大于150M的文件将被自动跳过</span>
                </div>
            </div>
        </transition>

        <!-- Result Modal -->
        <transition name="modal">
            <div v-if="showResultModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="showResultModal = false"></div>
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col relative z-10 overflow-hidden">
                    <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-download text-emerald-500"></i> 解析结果</h3>
                        <button @click="showResultModal = false" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                    </div>
                    
                    <div class="p-0 overflow-y-auto bg-slate-50/50 flex-1">
                        <!-- Content (Skipped, skipped list, links) same as before -->
                        <div v-if="skippedList.length > 0" class="p-4 bg-yellow-50 border-b border-yellow-100">
                            <div class="flex items-center gap-2 text-yellow-700 mb-2">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                                <span class="text-sm font-bold">跳过了 {{ skippedList.length }} 个大于 150MB 的文件</span>
                            </div>
                            <ul class="list-disc list-inside text-xs text-yellow-600 space-y-1 max-h-32 overflow-y-auto pl-1">
                                <li v-for="(file, idx) in skippedList" :key="idx" class="truncate">
                                    {{ file.server_filename }} <span class="opacity-75">({{ formatSize(file.size) }})</span>
                                </li>
                            </ul>
                        </div>

                        <div v-if="failedList.length > 0 || isRetrying" class="p-4 bg-orange-50 border-b border-orange-100 flex items-center justify-between sticky top-0 z-20">
                            <div class="flex items-center gap-2 text-orange-700">
                                <i class="fa-solid fa-circle-exclamation"></i>
                                <span class="text-sm font-bold">{{ failedList.length }} 个文件解析失败</span>
                            </div>
                            <button @click="retryFailed" :disabled="processing" 
                                class="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2">
                                <i v-if="processing" class="fa-solid fa-spinner fa-spin"></i>
                                <i v-else class="fa-solid fa-rotate-right"></i>
                                {{ processing ? '正在重试...' : '重试失败项' }}
                            </button>
                        </div>

                        <div v-if="resultErrors.length > 0" class="p-4 bg-red-50 border-b border-red-100">
                            <h4 class="text-red-700 font-bold text-sm mb-2">错误日志:</h4>
                            <ul class="list-disc list-inside text-xs text-red-600 space-y-1">
                                <li v-for="(err, idx) in resultErrors" :key="idx">{{ err }}</li>
                            </ul>
                        </div>

                        <div v-if="resultLinks.length > 0" class="divide-y divide-slate-100">
                            <div v-for="(item, idx) in resultLinks" :key="idx" class="p-4 hover:bg-white transition-colors">
                                <div class="flex justify-between items-start gap-4 mb-2">
                                    <div class="font-medium text-slate-700 break-all text-sm flex items-center gap-2">
                                        <span class="bg-emerald-100 text-emerald-600 text-[10px] px-1 rounded">PDF加速</span>
                                        <span :title="item.relativePath">{{ item.relativePath }}</span>
                                    </div>
                                    <span class="text-xs text-slate-400 whitespace-nowrap">{{ formatSize(item.size) }}</span>
                                </div>
                                <div class="flex flex-col gap-2">
                                    <div class="relative">
                                        <input readonly :value="item.dlink" class="w-full bg-slate-100 border border-slate-200 rounded-lg py-1.5 px-3 text-xs font-mono text-slate-600 focus:outline-none">
                                        <button @click="copyLink(item.dlink)" class="absolute right-1 top-1 bottom-1 px-2 bg-white border border-slate-200 rounded text-xs hover:bg-slate-50 text-slate-500">复制</button>
                                    </div>
                                    <div class="flex gap-2 mt-1">
                                        <button @click="openLink(item.dlink)" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs py-2 rounded-lg text-center font-medium shadow-sm shadow-emerald-100 transition-colors flex items-center justify-center gap-2">
                                            <i class="fa-solid fa-download"></i> 点击下载
                                        </button>
                                        <button @click="sendToLocalAria2(item)" class="flex-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs py-2 rounded-lg font-medium transition-colors">
                                            <i class="fa-solid fa-paper-plane"></i> 推送 Aria2
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-else-if="resultErrors.length === 0 && failedList.length === 0 && skippedList.length === 0" class="p-10 text-center text-slate-400">
                            无有效文件链接
                        </div>
                    </div>
                    
                    <div v-if="resultLinks.length > 0" class="px-6 py-3 border-t border-slate-100 bg-white flex justify-end gap-3">
                         <button @click="batchSendToAria2" class="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-sm font-medium transition flex items-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i> 全部推送 Aria2
                        </button>
                    </div>
                </div>
            </div>
        </transition>

        <!-- Auth Modal -->
        <transition name="modal">
            <div v-if="showAuthModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="showAuthModal = false"></div>
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm relative z-10 overflow-hidden">
                    <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 class="font-bold text-slate-800"><i class="fa-solid fa-shield-halved text-indigo-500 mr-2"></i>授权管理</h3>
                        <button @click="showAuthModal = false" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <div class="p-6 space-y-6">
                        
                        <!-- Status Display -->
                        <div class="flex items-center justify-between p-3 rounded-lg" :class="authStatus ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'">
                            <div class="flex items-center gap-3">
                                <div class="w-2 h-2 rounded-full" :class="authStatus ? 'bg-emerald-500' : 'bg-red-500'"></div>
                                <span class="text-sm font-medium" :class="authStatus ? 'text-emerald-700' : 'text-red-700'">
                                    {{ authStatus ? '已授权' : '未授权 / 已过期' }}
                                </span>
                            </div>
                            <span v-if="currentUser" class="text-xs text-slate-500">{{ currentUser.name }}</span>
                        </div>

                        <!-- Manual Token -->
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5 uppercase tracking-wider">Access Token</label>
                            <div class="relative">
                                <input type="password" v-model="tempConfig.accessToken" 
                                       :placeholder="cookieConfig.accessToken ? '已配置 (输入新Token以覆盖)' : '在此输入 API Token'" 
                                    class="w-full pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-sm font-mono transition-all">
                                <button v-if="tempConfig.accessToken" @click="tempConfig.accessToken = ''" 
                                    class="absolute top-0 bottom-0 right-2 flex items-center text-slate-400 hover:text-slate-600 transition-colors" title="清空">
                                    <i class="fa-solid fa-circle-xmark"></i>
                                </button>
                            </div>
                            
                            <!-- Remember Token Checkbox -->
                            <div class="mt-2 flex items-center gap-2">
                                <input type="checkbox" id="rememberToken" v-model="rememberToken" class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer">
                                <label for="rememberToken" class="text-xs text-slate-500 cursor-pointer select-none">记住 Token (保存到本地存储)</label>
                            </div>
                            
                            <p class="text-[10px] text-slate-400 mt-1.5" v-if="!rememberToken">未勾选时，Token 仅在当前会话有效，刷新页面即失效。</p>
                            <p class="text-[10px] text-slate-400 mt-1.5" v-else>安全提示：Token 将经过随机加盐哈希后存储在本地。</p>
                        </div>
                        
                        <!-- SSO Login -->
                        <div v-if="serverConfig.ssoEnabled">
                            <div class="relative flex py-2 items-center">
                                <div class="flex-grow border-t border-slate-100"></div>
                                <span class="flex-shrink-0 mx-4 text-slate-300 text-xs font-medium">或者使用 SSO</span>
                                <div class="flex-grow border-t border-slate-100"></div>
                            </div>
                            <button @click="loginWithSSO" class="w-full py-2.5 bg-white border border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-600 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 group shadow-sm hover:shadow">
                                <i class="fa-brands fa-linux text-lg group-hover:scale-110 transition-transform"></i> 
                                <span>Linux.do 登录</span>
                            </button>
                        </div>

                        <!-- Actions -->
                        <div class="pt-2 flex gap-3">
                            <button v-if="currentUser || cookieConfig.accessToken" @click="logout" 
                                class="flex-1 py-2 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors">
                                {{ currentUser ? '退出登录' : '清除配置' }}
                            </button>
                            <button @click="saveAuth" class="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-md shadow-indigo-100 transition-all active:scale-95">保存 Token</button>
                        </div>
                    </div>
                </div>
            </div>
        </transition>

        <!-- Settings Modal (Resources) -->
        <transition name="modal">
            <div v-if="showSettingsModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="showSettingsModal = false"></div>
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10">
                    <div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
                        <h3 class="font-bold text-slate-800">系统设置</h3>
                    </div>
                    <div class="p-6 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-700 mb-1">Baidu Cookie (BDUSS)</label>
                            <div class="relative">
                                <textarea v-model="tempConfig.bduss" rows="4" placeholder="BDUSS=..." 
                                    class="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-xs font-mono"></textarea>
                                <button v-if="tempConfig.bduss" @click="tempConfig.bduss = ''" 
                                    class="absolute top-2 right-2 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 rounded-full" title="清空">
                                    <i class="fa-solid fa-circle-xmark"></i>
                                </button>
                            </div>
                            <p class="text-xs text-slate-400 mt-1">留空则自动使用服务端账号池。</p>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Aria2 RPC</label>
                                <div class="relative">
                                    <input type="text" v-model="tempConfig.aria2Url" placeholder="http://localhost:6800/jsonrpc" 
                                        class="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-sm">
                                    <button v-if="tempConfig.aria2Url" @click="tempConfig.aria2Url = ''" 
                                        class="absolute top-0 bottom-0 right-2 flex items-center text-slate-400 hover:text-slate-600 transition-colors" title="清空">
                                        <i class="fa-solid fa-circle-xmark"></i>
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-700 mb-1">Aria2 Token</label>
                                <div class="relative">
                                    <input type="password" v-model="tempConfig.aria2Token" placeholder="Secret Key" 
                                        class="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 text-sm">
                                    <button v-if="tempConfig.aria2Token" @click="tempConfig.aria2Token = ''" 
                                        class="absolute top-0 bottom-0 right-2 flex items-center text-slate-400 hover:text-slate-600 transition-colors" title="清空">
                                        <i class="fa-solid fa-circle-xmark"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                        <button @click="showSettingsModal = false" class="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-medium">取消</button>
                        <button @click="saveConfig" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm">保存配置</button>
                    </div>
                </div>
            </div>
        </transition>

    </div>

    <script>
        const { createApp, ref, computed, onMounted } = Vue;

        createApp({
            setup() {
                const link = ref('');
                const loading = ref(false);
                const loadingDir = ref(false);
                const loadingText = ref('');
                const processing = ref(false);
                const errorMsg = ref('');
                const hasData = ref(false);
                
                const showResultModal = ref(false);
                const showSettingsModal = ref(false);
                const showAuthModal = ref(false);
                
                const shareData = ref({});
                const currentList = ref([]);
                const currentPath = ref([]);
                const dirCache = ref({});
                const resultLinks = ref([]);
                const resultErrors = ref([]);
                const failedList = ref([]); // 解析失败的文件
                const skippedList = ref([]); // 跳过的大文件
                const isRetrying = ref(false); 

                // Inject Server Config safely
                const serverConfig = window.SERVER_CONFIG || { authEnabled: false, ssoEnabled: false };
                
                const currentUser = ref(null);
                const authStatus = ref(false);

                const cookieConfig = ref({
                    bduss: '',
                    aria2Url: 'http://localhost:6800/jsonrpc',
                    aria2Token: '',
                    accessToken: '',
                    authSalt: ''
                });

                const tempConfig = ref({ ...cookieConfig.value });
                const rememberToken = ref(false);

                onMounted(async () => {
                    const saved = localStorage.getItem('baidu_worker_config');
                    if (saved) {
                        try { 
                            const parsed = JSON.parse(saved);
                            // Merge saved config
                            cookieConfig.value = { ...cookieConfig.value, ...parsed };
                            if (parsed.accessToken) {
                                rememberToken.value = true;
                            }
                        } catch(e){}
                    }
                    // Auto Check Auth
                    await checkAuthStatus();
                });

                const openAuthSettings = () => {
                    // Don't prefill token for security/UX, just let them overwrite if needed
                    tempConfig.value.accessToken = '';
                    showAuthModal.value = true;
                };

                const openSettings = () => {
                    tempConfig.value = JSON.parse(JSON.stringify(cookieConfig.value));
                    showSettingsModal.value = true;
                };

                const saveConfig = () => {
                    // Update only resource settings
                    cookieConfig.value.bduss = tempConfig.value.bduss;
                    cookieConfig.value.aria2Url = tempConfig.value.aria2Url;
                    cookieConfig.value.aria2Token = tempConfig.value.aria2Token;
                    persistConfig();
                    showSettingsModal.value = false;
                };

                const saveAuth = async () => {
                    // Only update token if user typed something new
                    if (tempConfig.value.accessToken) {
                        const salt = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                        const hash = await digestMessage(tempConfig.value.accessToken + salt);
                        cookieConfig.value.accessToken = hash;
                        cookieConfig.value.authSalt = salt;
                    }
                    
                    persistConfig();
                    showAuthModal.value = false;
                    checkAuthStatus(); // Re-check after token update
                };

                const persistConfig = () => {
                    const dataToSave = JSON.parse(JSON.stringify(cookieConfig.value));
                    if (!rememberToken.value) {
                        dataToSave.accessToken = '';
                        dataToSave.authSalt = '';
                    }
                    localStorage.setItem('baidu_worker_config', JSON.stringify(dataToSave));
                };
                
                const loginWithSSO = () => {
                    window.location.href = '/auth/login';
                };

                const logout = () => {
                    // Clear Token
                    cookieConfig.value.accessToken = '';
                    cookieConfig.value.authSalt = '';
                    tempConfig.value.accessToken = '';
                    rememberToken.value = false;
                    persistConfig();
                    // Clear Session Cookie via Server Redirect (needed for HttpOnly cookies)
                    window.location.href = "/auth/logout";
                };

                // --- Helper: SHA-256 ---
                const digestMessage = async (message) => {
                    const msgUint8 = new TextEncoder().encode(message);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                };

                // --- Auth Logic ---
                const checkAuthStatus = async () => {
                    // If auth is disabled globally, we are always "authorized"
                    if (!serverConfig.authEnabled) {
                        authStatus.value = true;
                        return;
                    }

                    try {
                        const res = await apiCall('/api/user', {}, true); // Silent check
                        authStatus.value = true;
                        if (res.user) currentUser.value = res.user;
                        if (errorMsg.value && errorMsg.value.includes('授权')) errorMsg.value = '';
                    } catch (e) {
                        authStatus.value = false;
                        currentUser.value = null;
                        // Don't show error msg on initial load
                    }
                };

                const apiCall = async (endpoint, payload, silent = false) => {
                    const headers = { 'Content-Type': 'application/json' };
                    if (cookieConfig.value.accessToken) {
                        headers['Authorization'] = 'Bearer ' + cookieConfig.value.accessToken;
                        if (cookieConfig.value.authSalt) {
                            headers['X-Auth-Salt'] = cookieConfig.value.authSalt;
                        }
                    }

                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload)
                    });
                    
                    if (res.status === 401) {
                        if (!silent) {
                            errorMsg.value = "授权失效，请点击右上角盾牌图标进行配置";
                            // Use the same open logic as the button
                            openAuthSettings();
                        }
                        throw new Error("Unauthorized");
                    }
                    
                    const data = await res.json();
                    if (!data.success) throw new Error(data.message || 'Unknown error');
                    return data;
                };

                const analyzeLink = async () => {
                    if (!link.value) return;
                    loading.value = true;
                    errorMsg.value = '';
                    hasData.value = false;
                    try {
                        const res = await apiCall('/api/list', { link: link.value });
                        shareData.value = { shareid: res.data.shareid, uk: res.data.uk, sekey: res.data.seckey || '' };
                        const list = res.data.list.map(mapFile);
                        dirCache.value['root'] = list;
                        currentList.value = list;
                        currentPath.value = [];
                        hasData.value = true;
                    } catch (e) {
                        errorMsg.value = '解析失败: ' + e.message;
                    } finally {
                        loading.value = false;
                    }
                };

                const loadDirectoryContent = async (folderPath) => {
                    if (dirCache.value[folderPath]) {
                        return dirCache.value[folderPath];
                    }
                    try {
                        const res = await apiCall('/api/list', { link: link.value, dir: folderPath });
                        const list = res.data.list.map(mapFile);
                        dirCache.value[folderPath] = list;
                        return list;
                    } catch (e) {
                        console.error("List Dir Failed", e);
                        return null;
                    }
                };

                // --- 递归扫描文件逻辑 (包含相对路径构建) ---
                const scanFilesRecursive = async (items, parentPath = '') => {
                    let files = [];
                    const chunks = [];
                    const concurrency = 3;
                    
                    for (let item of items) {
                        // 构建当前项的相对路径
                        const currentItemPath = parentPath 
                            ? parentPath + '/' + item.server_filename 
                            : item.server_filename;
                        
                        // 将相对路径附加到对象上，方便后续使用
                        item.relativePath = currentItemPath;

                        if (item.isdir == 1) {
                            chunks.push(async () => {
                                loadingText.value = '正在扫描目录: ' + currentItemPath + '...'; 
                                const children = await loadDirectoryContent(item.path);
                                if (children && children.length > 0) {
                                    // 递归调用时传入当前路径作为父路径
                                    const subFiles = await scanFilesRecursive(children, currentItemPath);
                                    files.push(...subFiles);
                                }
                            });
                        } else {
                            files.push(item);
                        }
                    }

                    let active = 0;
                    let index = 0;
                    const run = async () => {
                        if (index >= chunks.length) return;
                        const p = chunks[index++]();
                        active++;
                        await p;
                        active--;
                    };

                    while (index < chunks.length || active > 0) {
                        if (active < concurrency && index < chunks.length) {
                            run(); 
                        } else {
                            await new Promise(r => setTimeout(r, 50));
                        }
                    }
                    
                    return files;
                };
                
                const runDownloadTask = async (files, isRetry = false) => {
                     loadingDir.value = true; 
                     processing.value = true;
                     
                     if (!isRetry) {
                         // 全新任务：重置所有列表
                         resultLinks.value = [];
                         resultErrors.value = [];
                         failedList.value = [];
                         skippedList.value = [];
                     } else {
                         // 重试任务：只重置失败列表和错误日志，保留之前的结果和跳过列表
                         failedList.value = [];
                         resultErrors.value = []; 
                     }
                     
                     try {
                        let targetFiles = [];
                        
                        if (isRetry) {
                            loadingText.value = '准备重试失败任务...';
                            targetFiles = files;
                        } else {
                            loadingText.value = '正在递归扫描目录结构 (文件较多可能需要一点时间)...';
                            const rawItems = JSON.parse(JSON.stringify(files));
                            // 开始递归扫描，初始父路径为空
                            const allFiles = await scanFilesRecursive(rawItems, '');
                            
                            // 过滤大文件
                            targetFiles = allFiles.filter(f => f.size <= 157286400);
                            const skipped = allFiles.filter(f => f.size > 157286400);
                            if (skipped.length > 0) skippedList.value = skipped;
                        }

                        if (targetFiles.length === 0) {
                            if (!isRetry && skippedList.value.length === 0) alert("没有符合条件的文件");
                            if (skippedList.value.length > 0) showResultModal.value = true;
                            return;
                        }

                        // 分批处理
                        const BATCH_SIZE = 10; 
                        const totalBatches = Math.ceil(targetFiles.length / BATCH_SIZE);
                        
                        for (let i = 0; i < targetFiles.length; i += BATCH_SIZE) {
                            const batch = targetFiles.slice(i, i + BATCH_SIZE);
                            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
                            
                            loadingText.value = '正在解析第 ' + batchNum + ' / ' + totalBatches + ' 批 (共 ' + targetFiles.length + ' 个文件)...';
                            
                            try {
                                const filesPayload = batch.map(f => ({
                                    fs_id: f.fs_id,
                                    relativePath: f.relativePath, // 发送 Web 端构建的完整路径，主键
                                    server_filename: f.server_filename
                                }));

                                const res = await apiCall('/api/download', {
                                    files: filesPayload,
                                    share_data: shareData.value,
                                    cookie: cookieConfig.value.bduss
                                });
                                
                                if (res.files) {
                                    resultLinks.value.push(...res.files);
                                    const successPaths = new Set(res.files.map(f => f.relativePath));
                                    const batchFailures = batch.filter(f => !successPaths.has(f.relativePath));
                                    if (batchFailures.length > 0) failedList.value.push(...batchFailures);
                                }
                                if (res.errors && res.errors.length > 0) resultErrors.value.push(...res.errors);
                                
                            } catch (e) {
                                resultErrors.value.push('Batch ' + batchNum + ' failed: ' + e.message);
                                failedList.value.push(...batch);
                            }
                        }
                        
                        showResultModal.value = true;
                        if (!isRetry) currentList.value.forEach(f => { f.selected = false; });
                     } catch(e) {
                         if (!e.message.includes("Unauthorized")) alert('Error: ' + e.message);
                     } finally {
                        processing.value = false;
                        loadingDir.value = false; 
                        loadingText.value = '';
                        isRetrying.value = false; 
                     }
                };

                const submitDownload = async () => {
                    const selectedFiles = currentList.value.filter(f => f.selected);
                    if (!selectedFiles.length) return;
                    await runDownloadTask(selectedFiles);
                };
                
                const retryFailed = async () => {
                    if (failedList.value.length === 0) return;
                    isRetrying.value = true;
                    const filesToRetry = [...failedList.value];
                    await runDownloadTask(filesToRetry, true);
                };
                
                const downloadSingle = async (file) => {
                    await runDownloadTask([file]);
                };

                const batchSendToAria2 = async () => {
                    if (!resultLinks.value.length) return;
                    let count = 0;
                    for (const item of resultLinks.value) {
                        try { await sendToLocalAria2Logic(item); count++; } catch(e) { console.error(e); }
                    }
                    alert('已发送 ' + count + ' / ' + resultLinks.value.length + ' 个任务');
                };

                const sendToLocalAria2Logic = async (item) => {
                    const ua = navigator.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0";
                    const outPath = item.relativePath || item.filename;
                    const payload = {
                        jsonrpc: '2.0',
                        method: 'aria2.addUri',
                        id: Date.now().toString(),
                        params: [
                            cookieConfig.value.aria2Token ? 'token:' + cookieConfig.value.aria2Token : undefined,
                            [item.dlink],
                            { "out": outPath, "user-agent": ua }
                        ].filter(x => x !== undefined)
                    };
                    const rpcUrl = (cookieConfig.value.aria2Url || "").trim() || "http://localhost:6800/jsonrpc";
                    const res = await fetch(rpcUrl, {
                        method: 'POST', 
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error.message);
                };

                const sendToLocalAria2 = async (item) => {
                    try {
                        await sendToLocalAria2Logic(item);
                        alert("已推送到本地 Aria2");
                    } catch(e) {
                        alert("推送失败: " + e.message + "\\n请检查本地 Aria2 配置或 Mixed Content 问题");
                    }
                };

                const openLink = (url) => {
                    window.open(url, '_blank', 'noopener,noreferrer');
                };

                const mapFile = (f) => ({ ...f, selected: false });
                const isFolder = (f) => f.isdir == 1; 
                const isSupported = (f) => isFolder(f) || f.size <= 157286400;

                const handleNameClick = async (file) => {
                    if (isFolder(file)) {
                        enterFolder(file);
                    } else if (isSupported(file)) {
                        file.selected = !file.selected;
                    }
                };
                
                const handleSelectionClick = (file) => {
                    if (isSupported(file)) file.selected = !file.selected;
                }
                
                const toggleSelection = (file) => {
                    if (isSupported(file)) file.selected = !file.selected;
                };

                const enterFolder = async (folder) => {
                    loadingDir.value = true;
                    try {
                        const list = await loadDirectoryContent(folder.path);
                        if (list) {
                            currentList.value = list;
                            currentPath.value.push(folder);
                        }
                    } finally {
                        loadingDir.value = false;
                    }
                };

                const goUp = async () => {
                    if (currentPath.value.length === 0) return;
                    currentPath.value.pop();
                    if (currentPath.value.length === 0) {
                        currentList.value = dirCache.value['root'];
                    } else {
                        const parent = currentPath.value[currentPath.value.length-1];
                        const list = await loadDirectoryContent(parent.path);
                        if(list) currentList.value = list;
                    }
                };
                
                const resetToRoot = () => {
                    currentList.value = dirCache.value['root'];
                    currentPath.value = [];
                };

                const toggleAll = () => {
                    const target = !isAllSelected.value;
                    currentList.value.forEach(f => {
                        if (isSupported(f)) {
                            f.selected = target;
                        }
                    });
                };

                const selectedCount = computed(() => currentList.value.filter(f => f.selected).length);
                const isAllSelected = computed(() => currentList.value.length > 0 && selectedCount.value === currentList.value.filter(isSupported).length);
                
                const formatSize = (bytes, file) => {
                    if (file && isFolder(file)) return '-';
                    if (bytes === undefined || bytes === null || isNaN(bytes)) return '-';
                    if (bytes === 0) return '0 B';
                    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                };

                const getIcon = (file) => {
                    if (isFolder(file)) return 'fa-solid fa-folder';
                    const ext = (file.server_filename.split('.').pop() || '').toLowerCase();
                    const icons = {'zip':'fa-file-zipper','rar':'fa-file-zipper','pdf':'fa-file-pdf','mp4':'fa-file-video'};
                    return icons[ext] || 'fa-solid fa-file';
                };
                const getIconClass = (file) => {
                    if (isFolder(file)) return 'bg-amber-100 text-amber-500';
                    return 'bg-slate-100 text-slate-500';
                };
                const copyLink = (text) => { navigator.clipboard.writeText(text); };

                return {
                    link, loading, loadingDir, loadingText, processing, errorMsg, hasData,
                    currentList, currentPath, selectedCount, isAllSelected,
                    showResultModal, showSettingsModal, showAuthModal, resultLinks, resultErrors, failedList, skippedList, 
                    cookieConfig, tempConfig, isRetrying, serverConfig, authStatus, currentUser, rememberToken,
                    analyzeLink, submitDownload, retryFailed, downloadSingle, handleNameClick, handleSelectionClick, toggleSelection,
                    goUp, resetToRoot, toggleAll, formatSize, getIcon, getIconClass, isFolder, isSupported,
                    copyLink, saveConfig, saveAuth, sendToLocalAria2, batchSendToAria2, openLink, openSettings, openAuthSettings, loginWithSSO, logout
                };
            }
        }).mount('#app');
    </script>
</body>
</html>
`;