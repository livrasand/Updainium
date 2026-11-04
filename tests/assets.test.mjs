import test from "node:test";
import assert from "node:assert/strict";
import { assetForExtension, assetForPlatform, formats } from "../src/lib/assets.ts";

const linux = { os: "linux", arch: "x86_64" };
const linuxArm = { os: "linux", arch: "aarch64" };
const mac = { os: "macos", arch: "aarch64" };
const windows = { os: "windows", arch: "x86_64" };

const asset = (name) => ({ name, browser_download_url: `https://host/${name}` });
const nameOf = (result) => result?.name;

test("extension-based automatic detection still prefers native installer formats", () => {
  const assets = [
    asset("app-linux-x86_64"),
    asset("app_1.2.3_amd64.AppImage"),
    asset("app_1.2.3_arm64.deb"),
  ];
  assert.equal(assetForPlatform(assets, linux), assets[1]);
  assert.equal(assetForPlatform(assets, linuxArm), assets[2]);
});

test("extension-based automatic detection rejects incompatible architectures", () => {
  assert.equal(assetForPlatform([asset("app_1.2.3_arm64.AppImage")], linux), undefined);
  assert.equal(assetForPlatform([asset("app_1.2.3_arm64.AppImage")], { os: "linux", arch: "x86" }), undefined);
});

test("extensionless automatic detection accepts executables identifying the OS and architecture", () => {
  const assets = [
    asset("CHECKSUMS"),
    asset("example.toml"),
    asset("frankenphp-linux-x86_64"),
  ];
  assert.equal(assetForPlatform(assets, linux), assets[2]);
});

test("extensionless automatic detection rejects other operating systems' binaries", () => {
  assert.equal(assetForPlatform([asset("mytool-windows-x86_64")], linux), undefined);
  assert.equal(assetForPlatform([asset("mytool-darwin-aarch64")], linux), undefined);
  assert.equal(assetForPlatform([asset("mytool-darwin-aarch64")], windows), undefined);
  assert.equal(assetForPlatform([asset("mytool-linux-x86_64")], mac), undefined);
});

test("extensionless automatic detection rejects contradicting architecture hints", () => {
  assert.equal(assetForPlatform([asset("mytool-linux-aarch64")], linux), undefined);
  assert.equal(assetForPlatform([asset("mytool-linux-i686")], linux), undefined);
  assert.equal(assetForPlatform([asset("mytool-linux-x86_64")], linuxArm), undefined);
});

test("extensionless automatic detection prefers the binary matching the device architecture", () => {
  const assets = [
    asset("mytool-linux-armv7"),
    asset("mytool-linux-aarch64"),
    asset("mytool-linux-x86_64"),
  ];
  assert.equal(assetForPlatform(assets, linux), assets[2]);
  assert.equal(assetForPlatform(assets, linuxArm), assets[1]);
});

test("extensionless automatic detection accepts binaries without an architecture hint", () => {
  assert.equal(nameOf(assetForPlatform([asset("mytool-linux")], linux)), "mytool-linux");
  assert.equal(nameOf(assetForPlatform([asset("mytool-linux-universal")], linux)), "mytool-linux-universal");
});

test("extensionless automatic detection recognizes macOS and Windows markers", () => {
  assert.equal(nameOf(assetForPlatform([asset("mytool-macos-arm64")], mac)), "mytool-macos-arm64");
  assert.equal(nameOf(assetForPlatform([asset("mytool-darwin-aarch64")], mac)), "mytool-darwin-aarch64");
  assert.equal(nameOf(assetForPlatform([asset("mytool-win64")], windows)), "mytool-win64");
  assert.equal(nameOf(assetForPlatform([asset("mytool-win-x64")], windows)), "mytool-win-x64");
});

test("automatic detection mixes formats and extensionless binaries", () => {
  const assets = [asset("checksum.sha256"), asset("frankenphp-linux-x86_64"), asset("tool.apk")];
  assert.equal(assetForPlatform(assets, linux), assets[1]);
});

test("a single extensionless asset with no markers can still be followed automatically", () => {
  assert.equal(nameOf(assetForPlatform([asset("mytool")], linux)), "mytool");
  assert.equal(nameOf(assetForPlatform([asset("mytool")], mac)), "mytool");
});

test("two extensionless assets without markers remain ambiguous for automatic detection", () => {
  assert.equal(assetForPlatform([asset("mytool"), asset("mytool-mirror")], linux), undefined);
});

test("assets carrying another platform's installer extension are never auto-selected", () => {
  assert.equal(assetForPlatform([asset("mytool.exe")], linux), undefined);
  assert.equal(assetForPlatform([asset("mytool.dmg")], linux), undefined);
});

test("explicit extension filtering keeps matching the requested file", () => {
  const assets = [
    asset("app-setup.exe"),
    asset("app-1.2.3.zip"),
    asset("app-1.2.3-x86_64.zip"),
  ];
  assert.equal(assetForExtension(assets, ".zip", "x86_64", linux), assets[2]);
  assert.equal(assetForExtension(assets, ".zip", "auto", linux), assets[2]);
  assert.equal(assetForExtension(assets, ".zip", "aarch64", linux), assets[1]);
  assert.equal(assetForExtension(assets, "app-1.2.3.zip", "auto", linux), assets[1]);
  assert.equal(nameOf(assetForExtension(assets, ".exe", "auto", linux)), "app-setup.exe");
});

test("explicit extension filtering accepts universal naming and multi-part extensions", () => {
  const assets = [asset("app-universal.zip"), asset("app-aarch64.zip")];
  assert.equal(nameOf(assetForExtension(assets, ".zip", "x86_64", linux)), "app-universal.zip");
  assert.equal(assetForExtension(assets, ".zip", "x86_64", linux), assets[0]);
  const archives = [asset("app-1.2.3-x86_64.tar.gz")];
  assert.equal(assetForExtension(archives, ".tar.gz", "x86_64", linux), archives[0]);
});

test("every platform keeps at least one native format configured", () => {
  for (const os of ["linux", "macos", "windows"]) {
    assert.ok(formats[os]?.length > 0);
  }
});
