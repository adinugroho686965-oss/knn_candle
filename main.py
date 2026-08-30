import presentation


import ast
import os
import importlib.metadata

PROJECT_DIR = "."


def find_imports(project_dir):
    imports = set()

    for root, dirs, files in os.walk(project_dir):
        # Abaikan folder tertentu
        dirs[:] = [
            d for d in dirs
            if d not in {".git", ".venv", "venv", "__pycache__"}
        ]

        for file in files:
            if not file.endswith(".py"):
                continue

            path = os.path.join(root, file)

            try:
                with open(path, "r", encoding="utf-8") as f:
                    tree = ast.parse(f.read(), filename=path)

                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            imports.add(alias.name.split(".")[0])

                    elif isinstance(node, ast.ImportFrom):
                        if node.module:
                            imports.add(node.module.split(".")[0])

            except Exception as e:
                print(f"Gagal membaca {path}: {e}")

    return sorted(imports)


imports = find_imports(PROJECT_DIR)

print("\nLibrary yang digunakan:\n")
print(f"{'Library':<30} Version")
print("-" * 50)

for lib in imports:
    try:
        version = importlib.metadata.version(lib)
        print(f"{lib:<30} {version}")
    except importlib.metadata.PackageNotFoundError:
        print(f"{lib:<30} tidak ditemukan / built-in")

