import {fetchPost} from "siyuan";

/**
 * 读取文件（原生代码 app/src/plugin/Plugin.ts getFile 方法）
 * @param path 文件路径
 * @returns Promise<any> 返回原始响应，由调用方处理 code/msg/data
 */
export const getFile = (path: string): Promise<any> => {
    // 解决 400 parses request failed 问题，fetchPost 需要传递对象而不是 JSON 字符串
    return new Promise((resolve) => {
        fetchPost("/api/file/getFile", { path }, (response: any) => {
            resolve(response);
        });
    });
};

/**
 * 写入文件，返回 Promise
 * @param path 文件路径
 * @param content 文件内容
 * @returns Promise<any>
 */
export const putFile = (path: string, content: string): Promise<any> => {
    if (!path || !content) {
        return Promise.reject({ code: 400, msg: "path or content is empty" });
    }

    const formData = new FormData();
    formData.append("path", path);
    formData.append("isDir", "false");
    formData.append("file", new File([content], path.split("/").pop() ?? "", { type: "text/plain" }));

    return new Promise((resolve) => {
        fetchPost("/api/file/putFile", formData, (response: any) => {
            resolve(response);
        });
    });
};
