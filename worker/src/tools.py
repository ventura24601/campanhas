#!/usr/bin/env python3
"""Ferramentas de imagem/vídeo/PDF do agente de campanhas.
Uso: python3 tools.py <comando> '<json>'  → imprime JSON no stdout.
"""
import json, os, subprocess, sys
from collections import Counter
from PIL import Image, ImageDraw, ImageFont

PREVIEW_MAX = 1280


def _font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def preview(src, dst, maxw=PREVIEW_MAX):
    im = Image.open(src)
    if im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (200, 200, 200))
        bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[3])
        im = bg
    scale = min(1.0, maxw / max(im.size))
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.convert("RGB").save(dst, quality=88)
    return {"preview": dst, "scale": scale, "pw": im.width, "ph": im.height}


def probe(a):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", a["file"]], capture_output=True, text=True)
    return json.loads(out.stdout or "{}")


def video(a):
    """Folha de contato com timestamps + frames-chave em resolução cheia."""
    f, wd = a["file"], a["dir"]
    os.makedirs(wd, exist_ok=True)
    info = probe({"file": f})
    dur = float(info.get("format", {}).get("duration", 0))
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    step = max(1.0, dur / 40)
    times = [round(i * step, 2) for i in range(int(dur / step) + 1) if i * step < dur - 0.2]
    thumbs = []
    for t in times:
        p = os.path.join(wd, f"thumb_{t:06.2f}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", f, "-frames:v", "1", "-vf", "scale=320:-2", p])
        if os.path.exists(p):
            thumbs.append((t, p))
    cols = 8
    tw, th = 320, Image.open(thumbs[0][1]).height if thumbs else 180
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    fnt = _font(18)
    for i, (t, p) in enumerate(thumbs):
        x, y = (i % cols) * tw, (i // cols) * (th + 26)
        sheet.paste(Image.open(p), (x, y + 26))
        d.text((x + 6, y + 3), f"t={t:.1f}s", fill=(255, 255, 255), font=fnt)
    sp = os.path.join(wd, "contato.jpg")
    sheet.save(sp, quality=85)
    pv = preview(sp, os.path.join(wd, "contato_prev.jpg"), 1568)
    return {"duracao": dur, "audio": has_audio, "contato": pv["preview"], "tempos": times}


def frame(a):
    f, t, dst = a["file"], a["t"], a["out"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", f, "-frames:v", "1", dst])
    pv = preview(dst, dst.replace(".png", "_prev.jpg"))
    im = Image.open(dst)
    return {"arquivo": dst, "w": im.width, "h": im.height, **pv}


def pdf(a):
    """Renderiza páginas, extrai texto, imagens embutidas e fontes (com cobertura de glifos)."""
    import fitz
    from fontTools.ttLib import TTFont
    f, wd = a["file"], a["dir"]
    os.makedirs(wd, exist_ok=True)
    doc = fitz.open(f)
    pages, imgs, fonts = [], [], []
    seen = set()
    for i, pg in enumerate(doc):
        pix = pg.get_pixmap(dpi=200)
        p = os.path.join(wd, f"pag{i+1}.png")
        pix.save(p)
        pv = preview(p, os.path.join(wd, f"pag{i+1}_prev.jpg"))
        pages.append({"id": f"pag{i+1}", "arquivo": p, "w": pix.width, "h": pix.height, "texto": pg.get_text(), **pv})
        for img in pg.get_images(full=True):
            xref = img[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pm = fitz.Pixmap(doc, xref)
                if pm.width < 150 or pm.height < 150:
                    continue
                if pm.n - pm.alpha >= 4:
                    pm = fitz.Pixmap(fitz.csRGB, pm)
                ip = os.path.join(wd, f"img{len(imgs)+1}.png")
                pm.save(ip)
                ipv = preview(ip, ip.replace(".png", "_prev.jpg"), 640)
                imgs.append({"id": f"img{len(imgs)+1}", "arquivo": ip, "w": pm.width, "h": pm.height, **ipv})
            except Exception:
                pass
        for fo in pg.get_fonts(full=True):
            xref, name = fo[0], fo[3]
            if any(x["xref"] == xref for x in fonts):
                continue
            try:
                nm, ext, typ, buf = doc.extract_font(xref)
                fam = name.split("+")[-1]
                entry = {"xref": xref, "nome": fam, "tipo": ext, "arquivo": None, "glifos": None}
                if ext in ("ttf", "otf", "cff") and buf:
                    raw = os.path.join(wd, f"font_{xref}.{ext}")
                    open(raw, "wb").write(buf)
                    try:
                        tt = TTFont(raw)
                        # conserta tabelas para o Chromium aceitar (OTS) e lista glifos com contorno
                        fixed = os.path.join(wd, f"font_{xref}_fix.ttf" if ext == "ttf" else f"font_{xref}_fix.otf")
                        if "name" in tt:
                            for nid in (1, 4, 6):
                                tt["name"].setName(fam.replace(" ", ""), nid, 3, 1, 0x409)
                        if "post" in tt:
                            tt["post"].formatType = 3.0
                        tt.save(fixed)
                        cmap = tt.getBestCmap() or {}
                        chars = []
                        if "glyf" in tt:
                            g = tt["glyf"]
                            chars = [chr(c) for c, gn in cmap.items() if gn in g.keys() and g[gn].numberOfContours != 0]
                        else:
                            chars = [chr(c) for c in cmap.keys()]
                        entry.update({"arquivo": fixed, "glifos": "".join(sorted(set(chars)))})
                    except Exception as e:
                        entry["erro"] = str(e)
                fonts.append(entry)
            except Exception:
                pass
    return {"paginas": pages, "imagens": imgs, "fontes": fonts}


def image(a):
    f, wd = a["file"], a["dir"]
    os.makedirs(wd, exist_ok=True)
    im = Image.open(f)
    dst = os.path.join(wd, "img_" + os.path.splitext(os.path.basename(f))[0] + ".png")
    im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(dst)
    pv = preview(dst, dst.replace(".png", "_prev.jpg"))
    return {"arquivo": dst, "w": im.width, "h": im.height, **pv}


def crop(a):
    """Recorta de uma fonte (coords na PRÉVIA enviada ao agente; scale converte para o original)."""
    src, out, scale = a["src"], a["out"], a.get("scale", 1.0) or 1.0
    im = Image.open(src).convert("RGBA")
    if a.get("caixa"):
        x0, y0, x1, y1 = [v / scale for v in a["caixa"]]
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(im.width, int(x1)), min(im.height, int(y1))
        im = im.crop((x0, y0, x1, y1))
    if a.get("remover_fundo"):
        from rembg import remove, new_session
        im = remove(im.convert("RGB"), session=new_session("isnet-general-use"))
    if a.get("claro_transparente"):
        # remove o fundo liso: cor estimada pela borda da imagem; transparência proporcional à distância de cor
        px = im.load()
        W_, H_ = im.size
        borda = [px[x, 0] for x in range(W_)] + [px[x, H_ - 1] for x in range(W_)] + [px[0, y] for y in range(H_)] + [px[W_ - 1, y] for y in range(H_)]
        br, bg_, bb = [sorted(c[i] for c in borda)[len(borda) // 2] for i in range(3)]
        for y in range(H_):
            for x in range(W_):
                r, g, b, al = px[x, y]
                d = ((r - br) ** 2 + (g - bg_) ** 2 + (b - bb) ** 2) ** 0.5
                if d < 14:
                    px[x, y] = (r, g, b, 0)
                elif d < 40:
                    px[x, y] = (r, g, b, int(al * (d - 14) / 26))
    if a.get("remover_fundo") or a.get("claro_transparente"):
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
    im.save(out)
    # prévia sobre xadrez para o agente ver transparência
    chk = Image.new("RGBA", im.size, (255, 255, 255, 255))
    d = ImageDraw.Draw(chk)
    s = 16
    for yy in range(0, im.height, s):
        for xx in range(0, im.width, s):
            if (xx // s + yy // s) % 2:
                d.rectangle([xx, yy, xx + s, yy + s], fill=(205, 205, 205, 255))
    chk.alpha_composite(im)
    pv = out.replace(".png", "_prev.jpg")
    chk.convert("RGB").save(pv, quality=88)
    p2 = preview(pv, pv, 800)
    return {"arquivo": out, "w": im.width, "h": im.height, "preview": p2["preview"]}


def palette(a):
    im = Image.open(a["src"]).convert("RGB")
    sc = a.get("scale", 1.0) or 1.0
    if a.get("caixa"):
        x0, y0, x1, y1 = [int(v / sc) for v in a["caixa"]]
        im = im.crop((x0, y0, x1, y1))
    im = im.resize((max(1, im.width // 2), max(1, im.height // 2)))
    q = im.quantize(colors=10).convert("RGB")
    cnt = Counter(q.getdata())
    tot = sum(cnt.values())
    return {"cores": [{"hex": "#%02X%02X%02X" % c, "pct": round(100 * n / tot, 1)} for c, n in cnt.most_common(10)]}


def sheet(a):
    """Monta uma grade de imagens (prévias) com rótulos."""
    items, out, cols, cw = a["items"], a["out"], a.get("cols", 2), a.get("w", 800)
    ims = []
    for it in items:
        im = Image.open(it["arquivo"]).convert("RGB")
        r = cw / im.width
        ims.append((it.get("rotulo", ""), im.resize((cw, max(1, int(im.height * r))), Image.LANCZOS)))
    rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
    H = sum(max(im.height for _, im in r) + 30 for r in rows)
    sh = Image.new("RGB", (cols * cw + (cols - 1) * 10, H), (40, 40, 40))
    d = ImageDraw.Draw(sh)
    fnt = _font(20)
    y = 0
    for r in rows:
        rh = max(im.height for _, im in r)
        for j, (lb, im) in enumerate(r):
            x = j * (cw + 10)
            d.text((x + 6, y + 4), lb, fill=(255, 255, 255), font=fnt)
            sh.paste(im, (x, y + 30))
        y += rh + 30
    sh.save(out, quality=85)
    return {"arquivo": out, "w": sh.width, "h": sh.height}


def pdf2svg(a):
    """1ª página de um PDF (vetorial, gerado pelo Chromium) → SVG com texto em curvas.
    Coordenadas em px (w×h); "largura"/"altura" opcionais definem o tamanho físico (ex.: "148mm")."""
    import re
    import fitz
    page = fitz.open(a["pdf"])[0]
    w, h = a["w"], a["h"]
    m = fitz.Matrix(w / page.rect.width, h / page.rect.height)
    svg = page.get_svg_image(matrix=m, text_as_path=True)
    larg, alt = a.get("largura", str(w)), a.get("altura", str(h))
    svg = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"\s+height="[^"]*"', lambda mm: f'{mm.group(1)} width="{larg}" height="{alt}"', svg, count=1)
    with open(a["out"], "w", encoding="utf-8") as fh:
        fh.write(svg)
    return {"arquivo": a["out"], "bytes": os.path.getsize(a["out"])}


def raster(a):
    """SVG ou PDF (1ª página) → PNG com transparência, lado maior = max px."""
    import fitz
    doc = fitz.open(a["src"])
    page = doc[0]
    z = a.get("max", 1600) / max(page.rect.width, page.rect.height)
    page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=True).save(a["out"])
    im = Image.open(a["out"])
    return {"arquivo": a["out"], "w": im.width, "h": im.height}


CMDS = {"probe": probe, "video": video, "frame": frame, "pdf": pdf, "image": image, "crop": crop, "palette": palette, "sheet": sheet,
        "pdf2svg": pdf2svg, "raster": raster, "preview": lambda a: preview(a["src"], a["out"], a.get("max", PREVIEW_MAX))}

if __name__ == "__main__":
    cmd = sys.argv[1]
    arg = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    real = sys.stdout
    sys.stdout = sys.stderr  # bibliotecas (PyMuPDF, rembg) escrevem avisos no stdout
    try:
        import fitz
        fitz.TOOLS.mupdf_display_warnings(False)
    except Exception:
        pass
    res = CMDS[cmd](arg)
    real.write(json.dumps(res, ensure_ascii=False))
    real.flush()
