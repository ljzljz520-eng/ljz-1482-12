import axios, { AxiosError } from "axios";
import { toast } from "react-hot-toast";

export const api = axios.create({
  // @ts-ignore
  baseURL: import.meta.env.VITE_API_BASE || "/api",
  timeout: 12000,
});

/** 当前协作身份（甲/乙/丙） */
let currentUserId = localStorage.getItem("collab-user-id") || "u-jia";
export const getUserId = () => currentUserId;
export function setUserId(id: string) {
  currentUserId = id;
  localStorage.setItem("collab-user-id", id);
}

api.interceptors.request.use((config) => {
  config.headers["x-user-id"] = currentUserId;
  return config;
});

export class OfflineError extends Error {
  constructor() {
    super("OFFLINE");
  }
}

let onlineToastShown = false;

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // 离线 / 网络层失败：交给调用方进本地待提交队列，不弹通用错误
    if (!error.response) {
      if (navigator.onLine === false || error.code === "ERR_NETWORK") {
        if (!onlineToastShown) {
          toast("网络已断开，修改保留在本地待同步草稿中", { icon: "📴" });
          onlineToastShown = true;
          setTimeout(() => (onlineToastShown = false), 4000);
        }
        return Promise.reject(new OfflineError());
      }
      toast.error("网络请求失败，请稍后重试");
      return Promise.reject(error);
    }
    const status = error.response.status;
    const data = error.response.data as { message?: string } | undefined;
    // 409 冲突属于正常协作流，由调用方处理，不弹 toast
    if (status !== 409 && status !== 400) {
      toast.error(data?.message ?? `请求失败 (${status})`);
    }
    return Promise.reject(error);
  },
);
