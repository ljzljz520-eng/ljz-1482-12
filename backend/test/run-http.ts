/** 直接以 tsx 执行的测试入口：先装内存 Prisma，再导入用例文件 */
import "./setup-memory.js";
import "./http.smoke.test.js";
