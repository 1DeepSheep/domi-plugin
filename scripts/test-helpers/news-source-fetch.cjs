const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");

function mockPublicSource(pages) {
  const calls = [];
  const options = {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request(url, settings, callback) {
      calls.push({ url: url.href, settings });
      const request = new EventEmitter();
      let destroyed = false;
      request.destroy = error => { destroyed = true; if (error) request.emit("error", error); request.emit("close"); };
      request.end = () => queueMicrotask(() => {
        if (destroyed) return;
        const page = typeof pages === "function" ? pages(url, calls.length) : pages;
        if (page?.hang) return;
        const response = Readable.from([Buffer.from(typeof page === "string" ? page : page?.html || "")]);
        response.statusCode = page?.status || 200;
        response.headers = page?.headers || {};
        response.on("close", () => request.emit("close"));
        callback(response);
      });
      return request;
    }
  };
  return { options, calls };
}

module.exports = { mockPublicSource };
