#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>

#define DEFAULT_API_BASE "http://localhost:8000"
#define MAX_INPUT 1024

typedef struct {
    char *data;
    size_t size;
} ResponseBuffer;

static size_t write_callback(void *contents, size_t size, size_t nmemb, void *userp) {
    size_t total_size = size * nmemb;
    ResponseBuffer *buffer = (ResponseBuffer *)userp;

    char *ptr = realloc(buffer->data, buffer->size + total_size + 1);
    if (!ptr) {
        fprintf(stderr, "Memory allocation failed\n");
        return 0;
    }

    buffer->data = ptr;
    memcpy(&(buffer->data[buffer->size]), contents, total_size);
    buffer->size += total_size;
    buffer->data[buffer->size] = '\0';

    return total_size;
}

char *read_file(const char *path) {
    FILE *file = fopen(path, "rb");
    if (!file) {
        fprintf(stderr, "Could not open file: %s\n", path);
        return NULL;
    }

    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    rewind(file);

    char *buffer = malloc(size + 1);
    if (!buffer) {
        fclose(file);
        fprintf(stderr, "Memory allocation failed\n");
        return NULL;
    }

    fread(buffer, 1, size, file);
    buffer[size] = '\0';

    fclose(file);
    return buffer;
}

char *json_escape(const char *input) {
    size_t len = strlen(input);
    char *escaped = malloc(len * 2 + 1);

    if (!escaped) return NULL;

    size_t j = 0;

    for (size_t i = 0; i < len; i++) {
        char c = input[i];

        switch (c) {
            case '"':
                escaped[j++] = '\\';
                escaped[j++] = '"';
                break;
            case '\\':
                escaped[j++] = '\\';
                escaped[j++] = '\\';
                break;
            case '\n':
                escaped[j++] = '\\';
                escaped[j++] = 'n';
                break;
            case '\r':
                escaped[j++] = '\\';
                escaped[j++] = 'r';
                break;
            case '\t':
                escaped[j++] = '\\';
                escaped[j++] = 't';
                break;
            default:
                escaped[j++] = c;
                break;
        }
    }

    escaped[j] = '\0';
    return escaped;
}

void http_request(const char *method, const char *path, const char *body) {
    CURL *curl = curl_easy_init();

    if (!curl) {
        fprintf(stderr, "Failed to initialize curl\n");
        return;
    }

    const char *api_base = getenv("AIF_API_BASE");
    if (!api_base) {
        api_base = DEFAULT_API_BASE;
    }

    char url[2048];
    snprintf(url, sizeof(url), "%s%s", api_base, path);

    ResponseBuffer response;
    response.data = malloc(1);
    response.size = 0;

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    if (strcmp(method, "POST") == 0) {
        curl_easy_setopt(curl, CURLOPT_POST, 1L);

        if (body) {
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
        }
    }

    CURLcode result = curl_easy_perform(curl);

    if (result != CURLE_OK) {
        fprintf(stderr, "Request failed: %s\n", curl_easy_strerror(result));
    } else {
        long status_code;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status_code);

        printf("\nHTTP %ld\n", status_code);

        if (response.data && response.size > 0) {
            printf("%s\n", response.data);
        } else {
            printf("(empty response)\n");
        }
    }

    free(response.data);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
}

void print_help(void) {
    printf("\nInfraVM Shell Commands:\n");
    printf("  health                 Check backend health\n");
    printf("  status                 Alias for health\n");
    printf("  providers              Show provider key status via health\n");
    printf("  objects                List AIF objects\n");
    printf("  object <id>            Get one AIF object\n");
    printf("  logs                   Show VM logs\n");
    printf("  peers                  List peers\n");
    printf("  discover               Discover peers\n");
    printf("  run-start              Run object with $start$ marker\n");
    printf("  run                    Alias for run-start\n");
    printf("  pointrun <id>          Run object by pointer/object id\n");
    printf("  compile <file>         Compile source file\n");
    printf("  help                   Show this help\n");
    printf("  exit                   Quit shell\n\n");
}

void handle_compile(const char *filename) {
    char *source = read_file(filename);

    if (!source) {
        return;
    }

    char *escaped_source = json_escape(source);
    char *escaped_name = json_escape(filename);

    if (!escaped_source || !escaped_name) {
        fprintf(stderr, "JSON escaping failed\n");
        free(source);
        free(escaped_source);
        free(escaped_name);
        return;
    }

    size_t body_size = strlen(escaped_source) + strlen(escaped_name) + 64;
    char *body = malloc(body_size);

    if (!body) {
        fprintf(stderr, "Memory allocation failed\n");
        free(source);
        free(escaped_source);
        free(escaped_name);
        return;
    }

    snprintf(
        body,
        body_size,
        "{\"source\":\"%s\",\"name\":\"%s\"}",
        escaped_source,
        escaped_name
    );

    http_request("POST", "/api/compile", body);

    free(source);
    free(escaped_source);
    free(escaped_name);
    free(body);
}

void run_shell(void) {
    char input[MAX_INPUT];

    printf("InfraVM / InfraOS C Shell\n");
    printf("API Base: %s\n", getenv("AIF_API_BASE") ? getenv("AIF_API_BASE") : DEFAULT_API_BASE);
    printf("Type 'help' for commands.\n\n");

    while (1) {
        printf("infra> ");
        fflush(stdout);

        if (!fgets(input, sizeof(input), stdin)) {
            break;
        }

        input[strcspn(input, "\n")] = 0;

        if (strlen(input) == 0) {
            continue;
        }

        char *command = strtok(input, " ");
        char *arg = strtok(NULL, "");

        if (!command) {
            continue;
        }

        if (strcmp(command, "exit") == 0 || strcmp(command, "quit") == 0) {
            printf("Exiting InfraVM shell.\n");
            break;
        }

        else if (strcmp(command, "help") == 0) {
            print_help();
        }

        else if (strcmp(command, "health") == 0 || strcmp(command, "status") == 0 || strcmp(command, "providers") == 0) {
            http_request("GET", "/api/health", NULL);
        }

        else if (strcmp(command, "objects") == 0) {
            http_request("GET", "/api/objects", NULL);
        }

        else if (strcmp(command, "object") == 0) {
            if (!arg) {
                printf("Usage: object <id>\n");
                continue;
            }

            char path[1024];
            snprintf(path, sizeof(path), "/api/objects/%s", arg);
            http_request("GET", path, NULL);
        }

        else if (strcmp(command, "logs") == 0) {
            http_request("GET", "/api/logs", NULL);
        }

        else if (strcmp(command, "peers") == 0) {
            http_request("GET", "/api/peers", NULL);
        }

        else if (strcmp(command, "discover") == 0) {
            http_request("POST", "/api/peers/discover", "{}");
        }

        else if (strcmp(command, "run-start") == 0 || strcmp(command, "run") == 0) {
            http_request("POST", "/api/vm/run-start", "{}");
        }

        else if (strcmp(command, "pointrun") == 0) {
            if (!arg) {
                printf("Usage: pointrun <object_id>\n");
                continue;
            }

            char path[1024];
            snprintf(path, sizeof(path), "/api/vm/pointrun/%s", arg);
            http_request("POST", path, "{}");
        }

        else if (strcmp(command, "compile") == 0) {
            if (!arg) {
                printf("Usage: compile <source_file>\n");
                continue;
            }

            handle_compile(arg);
        }

        else {
            printf("Unknown command: %s\n", command);
            printf("Type 'help' to see commands.\n");
        }
    }
}

int main(void) {
    printf("Starting InfraOS\n");
    printf("Copyright 2026 Tangible Research Institute, Inc. All rights reserved.\n");
    curl_global_init(CURL_GLOBAL_ALL);
    run_shell();
    curl_global_cleanup();
    return 0;
}
