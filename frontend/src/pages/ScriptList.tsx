import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clapperboard, FilePlus2, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import toast from "react-hot-toast";

interface Item {
  id: string;
  title: string;
  headRev: number;
}

export default function ScriptList() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setItems((await api.listScripts()).scripts);
    } catch (e) {
      toast.error(`加载失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!title.trim()) return toast.error("请输入脚本标题");
    try {
      const r = await api.createScript(title.trim());
      toast.success("已创建新脚本");
      window.location.href = `/scripts/${r.id}`;
    } catch (e) {
      toast.error(`创建失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/60 bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400 flex items-center justify-center text-white">
            <Clapperboard size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">ScriptStudio · 协作脚本工作台</h1>
            <p className="text-xs text-slate-500">拆场 · 旁白/台词/镜头/时长 · 修订持久化 · 显式合并</p>
          </div>
          <button className="btn-ghost ml-auto" onClick={load}>
            <RefreshCw size={15} /> 刷新
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="card p-5 mb-6 flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="新脚本标题，如：秋日纪录片脚本"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="btn-primary" onClick={create}>
            <FilePlus2 size={16} /> 新建脚本
          </button>
          <span className="text-xs text-slate-400 ml-auto">所有协作操作均以不可变修订形式保存在服务端</span>
        </div>

        {loading ? (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-4 w-48 bg-slate-200 rounded mb-3" />
                <div className="h-3 w-24 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((it) => (
              <Link
                key={it.id}
                to={`/scripts/${it.id}`}
                className="card p-5 flex items-center gap-4 hover:-translate-y-0.5 hover:shadow-lg transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Clapperboard size={20} />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5">ID: {it.id}</div>
                </div>
                <span className="badge bg-slate-100 text-slate-500 ml-auto">最新修订 rev {it.headRev}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
