import { ref, computed } from 'vue';
import { fileApi } from '@/modules/agent/native/src/api/v1';

export interface StagedFileInfo {
    attachment_id: string;
    filename: string;
    original_name: string;
    url: string;  // blob URL for preview
    type: string;  // image, record, file, video
    signature?: string;
    sourceFile?: File;
    libraryId?: string;
}

export function useMediaHandling() {
    const stagedFiles = ref<StagedFileInfo[]>([]);
    const mediaCache = ref<Record<string, string>>({});
    const pendingFileSignatures = new Set<string>();

    async function getFileSignature(file: File): Promise<string> {
        if (crypto?.subtle) {
            const buffer = await file.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', buffer);
            const hash = Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
            return `sha256:${hash}`;
        }

        return `meta:${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    }

    function isDuplicateFile(signature: string) {
        return (
            pendingFileSignatures.has(signature) ||
            stagedFiles.value.some(file => file.signature === signature)
        );
    }

    async function getMediaFile(filename: string): Promise<string> {
        if (mediaCache.value[filename]) {
            return mediaCache.value[filename];
        }

        try {
            const response = await fileApi.getByName(filename);

            const blobUrl = URL.createObjectURL(response.data);
            mediaCache.value[filename] = blobUrl;
            return blobUrl;
        } catch (error) {
            console.error('Error fetching media file:', error);
            return '';
        }
    }

    async function uploadStagedFile(file: File): Promise<StagedFileInfo | undefined> {
        const signature = await getFileSignature(file);
        if (isDuplicateFile(signature)) return undefined;

        pendingFileSignatures.add(signature);
        const stagedFile: StagedFileInfo = {
            attachment_id: '',
            filename: file.name,
            original_name: file.name,
            url: URL.createObjectURL(file),
            type: previewType(file),
            signature,
            sourceFile: file,
        };
        stagedFiles.value.push(stagedFile);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fileApi.upload(formData);
            const { attachment_id, filename, type } = response.data.data;
            stagedFile.attachment_id = attachment_id;
            stagedFile.filename = filename;
            if (type) stagedFile.type = type;
            return stagedFile;
        } catch (err) {
            console.error('Error uploading file:', err);
            return stagedFile;
        } finally {
            pendingFileSignatures.delete(signature);
        }
    }

    function stageExternal(info: { url: string; name: string; type: string; libraryId?: string }) {
        if (info.libraryId && stagedFiles.value.some(file => file.libraryId === info.libraryId)) return;
        stagedFiles.value.push({
            attachment_id: info.libraryId ? `library:${info.libraryId}` : '',
            filename: info.name,
            original_name: info.name,
            url: info.url,
            type: info.type,
            libraryId: info.libraryId,
        });
    }

    function unstageLibrary(id: string) {
        const index = stagedFiles.value.findIndex(file => file.libraryId === id);
        if (index < 0) return;
        stagedFiles.value.splice(index, 1);
    }

    async function processAndUploadImage(file: File) {
        return uploadStagedFile(file);
    }

    async function processAndUploadFile(file: File) {
        return uploadStagedFile(file);
    }

    async function handlePaste(event: ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) {
                    await processAndUploadImage(file);
                }
            }
        }
    }

    function removeImage(index: number) {
        // 找到第 index 个图片类型的文件
        let imageCount = 0;
        for (let i = 0; i < stagedFiles.value.length; i++) {
            if (stagedFiles.value[i].type === 'image') {
                if (imageCount === index) {
                    const fileToRemove = stagedFiles.value[i];
                    if (fileToRemove.url.startsWith('blob:')) {
                        URL.revokeObjectURL(fileToRemove.url);
                    }
                    stagedFiles.value.splice(i, 1);
                    return;
                }
                imageCount++;
            }
        }
    }

    function removeAudio() {
        for (let i = stagedFiles.value.length - 1; i >= 0; i--) {
            if (stagedFiles.value[i].type !== 'record') continue;

            const fileToRemove = stagedFiles.value[i];
            if (fileToRemove.url.startsWith('blob:')) {
                URL.revokeObjectURL(fileToRemove.url);
            }
            stagedFiles.value.splice(i, 1);
        }
    }

    function removeFile(index: number) {
        // Find the requested non-image, non-audio attachment.
        let fileCount = 0;
        for (let i = 0; i < stagedFiles.value.length; i++) {
            if (
                stagedFiles.value[i].type !== 'image' &&
                stagedFiles.value[i].type !== 'record'
            ) {
                if (fileCount === index) {
                    const fileToRemove = stagedFiles.value[i];
                    if (fileToRemove.url.startsWith('blob:')) {
                        URL.revokeObjectURL(fileToRemove.url);
                    }
                    stagedFiles.value.splice(i, 1);
                    return;
                }
                fileCount++;
            }
        }
    }

    function clearStaged(options: { revokeUrls?: boolean } = {}) {
        const { revokeUrls = true } = options;
        if (revokeUrls) {
            // 清理文件的 blob URLs
            stagedFiles.value.forEach(file => {
                if (file.url.startsWith('blob:')) {
                    URL.revokeObjectURL(file.url);
                }
            });
        }
        stagedFiles.value = [];
    }

    function replaceStaged(files: StagedFileInfo[]) {
        stagedFiles.value = files;
    }

    function cleanupMediaCache() {
        Object.values(mediaCache.value).forEach(url => {
            if (url.startsWith('blob:')) {
                URL.revokeObjectURL(url);
            }
        });
        mediaCache.value = {};
    }

    // 计算属性：获取图片的 URL 列表（用于预览）
    const stagedImageFiles = computed(() =>
        stagedFiles.value.filter(f => f.type === 'image')
    );

    const stagedImagesUrl = computed(() =>
        stagedImageFiles.value.map(f => f.url)
    );

    const stagedAudioUrl = computed(() =>
        stagedFiles.value.find(f => f.type === 'record')?.url || ''
    );

    // 计算属性：获取非图片文件列表
    const stagedNonImageFiles = computed(() => 
        stagedFiles.value.filter(f => f.type !== 'image' && f.type !== 'record')
    );

    return {
        stagedImagesUrl,
        stagedImageFiles,
        stagedAudioUrl,
        stagedFiles,
        stagedNonImageFiles,
        getMediaFile,
        processAndUploadImage,
        processAndUploadFile,
        stageExternal,
        unstageLibrary,
        handlePaste,
        removeImage,
        removeAudio,
        removeFile,
        clearStaged,
        replaceStaged,
        cleanupMediaCache
    };
}

function previewType(file: File) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'record';
    if (file.type.startsWith('video/')) return 'video';
    return 'file';
}
