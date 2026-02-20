
import os
import re

# Paths
ROOT_DIR = os.getcwd()
INTERNAL_APP_DIR = os.path.join(ROOT_DIR, 'projects/internal-app/src/app/pages/admin')

# Replacements
REPLACEMENTS = [
    # Core Services
    (r"from\s+['\"](\.\./)*core/services/.*['\"]", "from '@lib/core'"),
    (r"from\s+['\"]src/app/core/services/.*['\"]", "from '@lib/core'"),
    
    # Core Models
    (r"from\s+['\"](\.\./)*core/models/.*['\"]", "from '@lib/core'"),
    (r"from\s+['\"]src/app/core/models/.*['\"]", "from '@lib/core'"),

    # Shared UI Kit (if strict path found)
    (r"from\s+['\"](\.\./)*shared/ui-kit/.*['\"]", "from '@lib/ui-kit'"),
]

def process_file(filepath):
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        
        original_content = content
        
        for pattern, replacement in REPLACEMENTS:
            # Use regex substitution
            content = re.sub(pattern, replacement, content)
            
        if content != original_content:
            print(f"Updating {filepath}")
            with open(filepath, 'w') as f:
                f.write(content)
    except Exception as e:
        print(f"Error processing {filepath}: {e}")

def walk_and_process(directory):
    if not os.path.exists(directory):
        print(f"Directory not found: {directory}")
        return
        
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.ts'):
                process_file(os.path.join(root, file))

if __name__ == "__main__":
    print("Starting internal-app import refactoring...")
    walk_and_process(INTERNAL_APP_DIR)
    print("Finished internal-app import refactoring.")
