from send_to_chroma import extract_pdf_elements, store_no_embed, delete_all_files

def do_it(pdfpath: str, savepath: str = "./pdf"):
    texts = extract_pdf_elements(pdfpath, savepath)
    delete_all_files(savepath)
    store_no_embed(texts, pdfpath)
